import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const MOCK_DIR = '.s3StoreMock'

export default function createS3Store(bucket, { mockDir = MOCK_DIR } = {}) {
  return new S3StoreMock(bucket, { mockDir })
}

class S3StoreMock {
  #bucket
  #basePath

  constructor(bucket, { mockDir = MOCK_DIR } = {}) {
    this.#bucket = bucket
    this.#basePath = path.join(process.cwd(), mockDir, bucket)
  }

  async #ensureDir(filePath) {
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })
  }

  async #getFilePath(key) {
    return path.join(this.#basePath, key)
  }

  async #getMetaPath(key) {
    return path.join(this.#basePath, `${key}.meta`)
  }

  async #calculateEtag(content) {
    const hash = crypto.createHash('md5')
    hash.update(content)
    return `"${hash.digest('hex')}"`
  }

  async #fileExists(filePath) {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  async #readMeta(key) {
    const metaPath = await this.#getMetaPath(key)
    try {
      const metaContent = await fs.readFile(metaPath, 'utf8')
      return JSON.parse(metaContent)
    } catch {
      return null
    }
  }

  async #writeMeta(key, meta) {
    const metaPath = await this.#getMetaPath(key)
    await this.#ensureDir(metaPath)
    await fs.writeFile(metaPath, JSON.stringify(meta), 'utf8')
  }

  async createObject(key, body, contentType = 'application/json') {
    const filePath = await this.#getFilePath(key)

    // Check if file already exists
    if (await this.#fileExists(filePath)) {
      throw new KeyExistsError('cannot overwrite an existing key')
    }

    await this.#ensureDir(filePath)

    const content = body instanceof Buffer ? body : Buffer.from(body)
    await fs.writeFile(filePath, content)

    const etag = await this.#calculateEtag(content)
    await this.#writeMeta(key, { etag, contentType })

    return new ResponseWrapper({ etag, contentType }, etag)
  }

  async putObjectIfMatch(key, body, etag, contentType = 'application/json') {
    const filePath = await this.#getFilePath(key)
    const meta = await this.#readMeta(key)

    if (!meta || meta.etag !== etag) {
      throw new StaleDataError('object was modified concurrently, reload your object first')
    }

    await this.#ensureDir(filePath)

    const content = body instanceof Buffer ? body : Buffer.from(body)
    await fs.writeFile(filePath, content)

    const newEtag = await this.#calculateEtag(content)
    await this.#writeMeta(key, { etag: newEtag, contentType })

    return new ResponseWrapper({ etag: newEtag, contentType }, newEtag)
  }

  async getObjectIfMatch(key, etag) {
    const filePath = await this.#getFilePath(key)
    const fileExists = await this.#fileExists(filePath)

    if (!fileExists) {
      const error = new Error('The specified key does not exist.')
      error.name = 'NoSuchKey'
      error.Code = 'NoSuchKey'
      throw error
    }

    const meta = await this.#readMeta(key)

    if (!meta || meta.etag !== etag) {
      throw new StaleDataError('object was modified concurrently, reload your object first. use getObject() instead')
    }

    return this.getObject(key)
  }

  async getObject(key) {
    const filePath = await this.#getFilePath(key)
    const meta = await this.#readMeta(key)

    try {
      const content = await fs.readFile(filePath)

      const response = {
        Body: {
          content,
          transformToString: async () => content.toString('utf8'),
          transformToByteArray: async () => new Uint8Array(content),
          transformToWebStream: async () => {
            return new ReadableStream({
              start(controller) {
                controller.enqueue(content)
                controller.close()
              }
            })
          }
        }
      }

      return new GetResponseWrapper(response, meta?.etag)
    } catch (err) {
      if (err.code === 'ENOENT') {
        const error = new Error('The specified key does not exist.')
        error.Code = 'NoSuchKey'
        throw error
      }
      throw err
    }
  }

  async deleteObjectIfMatch(key, etag) {
    const meta = await this.#readMeta(key)

    if (!meta || meta.etag !== etag) {
      throw new StaleDataError('object was modified concurrently, cannot proceed with deletion')
    }

    return this.deleteObject(key)
  }

  async deleteObject(key) {
    const filePath = await this.#getFilePath(key)
    const metaPath = await this.#getMetaPath(key)

    try {
      await fs.unlink(filePath)
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err
      }
    }

    try {
      await fs.unlink(metaPath)
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err
      }
    }

    return new ResponseWrapper({}, null)
  }

  /**
   * creates an async iterator that yields objects in the bucket:
   *
   * ```js
   * for await (const objects of store.list('some/prefix')) {
   *   console.log(objects)
   * }
   * ```
   *
   *
   * @param {string} prefix optional prefix to filter objects by
   * @returns
   */
  list(prefix = '') {
    const basePath = this.#basePath

    return {
      async *[Symbol.asyncIterator]() {
        const searchPath = path.join(basePath, prefix)

        try {
          await fs.access(searchPath)
        } catch {
          // Path doesn't exist, return empty
          return
        }

        const results = []

        async function walk(dir, baseDir) {
          const entries = await fs.readdir(dir, { withFileTypes: true })

          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name)

            if (entry.isDirectory()) {
              await walk(fullPath, baseDir)
            } else if (entry.isFile() && !entry.name.endsWith('.meta')) {
              const relativePath = path.relative(baseDir, fullPath)
              const stats = await fs.stat(fullPath)

              results.push({
                Key: relativePath.replace(/\\/g, '/'), // Normalize path separators
                LastModified: stats.mtime,
                Size: stats.size
              })
            }
          }
        }

        await walk(searchPath, basePath)

        if (results.length > 0) {
          yield results
        }
      }
    }
  }

  get bucket() {
    return this.#bucket
  }
}

class ResponseWrapper {
  #response
  #etag

  constructor(response, etag) {
    this.#response = response
    this.#etag = etag
  }

  get etag() {
    return this.#etag
  }

  get response() {
    return this.#response
  }
}

class GetResponseWrapper extends ResponseWrapper {
  async asString() {
    return this.response.Body.transformToString()
  }

  async asByteArray() {
    return this.response.Body.transformToByteArray()
  }

  async asWebStream() {
    return this.response.Body.transformToWebStream()
  }

  async asJson() {
    return JSON.parse(await this.response.Body.transformToString())
  }
}

export class UnsupportedBucketOperationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UnsupportedBucketOperationError'
  }
}

export class StaleDataError extends Error {
  constructor(message, originalError) {
    super(message)
    this.name = 'StaleDataError'
    this.originalError = originalError
  }
}

export class KeyExistsError extends Error {
  constructor(message, originalError) {
    super(message)
    this.name = 'KeyExistsError'
    this.originalError = originalError
  }
}
