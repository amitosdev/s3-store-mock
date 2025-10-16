/**
 * Mock implementation of @kessler/s3-store using local file system
 */

export interface S3StoreOptions {
  /** Directory name for mock storage (default: '.s3StoreMock') */
  mockDir?: string
}

export interface ResponseWrapper {
  /** The ETag of the object */
  readonly etag: string | null
  /** The raw response object */
  readonly response: any
}

export interface GetResponseWrapper extends ResponseWrapper {
  /** Convert the response body to a string */
  asString(): Promise<string>
  /** Convert the response body to a byte array */
  asByteArray(): Promise<Uint8Array>
  /** Convert the response body to a web stream */
  asWebStream(): Promise<ReadableStream>
  /** Parse the response body as JSON */
  asJson<T = any>(): Promise<T>
}

export interface ListObjectResult {
  /** The key of the object */
  Key: string
  /** Last modified date of the object */
  LastModified: Date
  /** Size of the object in bytes */
  Size: number
}

export interface S3StoreMock {
  /** The bucket name */
  readonly bucket: string

  /**
   * Create a new object in the store. Fails if the key already exists.
   * @param key - The object key
   * @param body - The object content (string or Buffer)
   * @param contentType - The content type (default: 'application/json')
   * @returns Response wrapper with etag
   * @throws {KeyExistsError} If the key already exists
   */
  createObject(key: string, body: string | Buffer, contentType?: string): Promise<ResponseWrapper>

  /**
   * Update an object only if the etag matches.
   * @param key - The object key
   * @param body - The object content (string or Buffer)
   * @param etag - The expected etag
   * @param contentType - The content type (default: 'application/json')
   * @returns Response wrapper with new etag
   * @throws {StaleDataError} If the etag doesn't match
   */
  putObjectIfMatch(key: string, body: string | Buffer, etag: string, contentType?: string): Promise<ResponseWrapper>

  /**
   * Get an object only if the etag matches.
   * @param key - The object key
   * @param etag - The expected etag
   * @returns Get response wrapper
   * @throws {NoSuchKeyError} If the key doesn't exist
   * @throws {StaleDataError} If the etag doesn't match
   */
  getObjectIfMatch(key: string, etag: string): Promise<GetResponseWrapper>

  /**
   * Get an object without etag validation.
   * @param key - The object key
   * @returns Get response wrapper
   * @throws {NoSuchKeyError} If the key doesn't exist
   */
  getObject(key: string): Promise<GetResponseWrapper>

  /**
   * Delete an object only if the etag matches.
   * @param key - The object key
   * @param etag - The expected etag
   * @returns Response wrapper
   * @throws {StaleDataError} If the etag doesn't match
   */
  deleteObjectIfMatch(key: string, etag: string): Promise<ResponseWrapper>

  /**
   * Delete an object without etag validation.
   * @param key - The object key
   * @returns Response wrapper
   */
  deleteObject(key: string): Promise<ResponseWrapper>

  /**
   * List objects in the bucket with optional prefix filter.
   * Returns an async iterator that yields arrays of object metadata.
   *
   * @example
   * ```typescript
   * for await (const objects of store.list('some/prefix')) {
   *   console.log(objects)
   * }
   * ```
   *
   * @param prefix - Optional prefix to filter objects by
   * @returns Async iterator of object results
   */
  list(prefix?: string): AsyncIterable<ListObjectResult[]>
}

/**
 * NoSuchKey error thrown when a key doesn't exist
 */
export interface NoSuchKeyError extends Error {
  name: 'NoSuchKey'
  message: 'The specified key does not exist.'
}

/**
 * Error thrown when trying to create an object with a key that already exists
 */
export class KeyExistsError extends Error {
  name: 'KeyExistsError'
  originalError?: Error
  constructor(message: string, originalError?: Error)
}

/**
 * Error thrown when an etag doesn't match (concurrent modification detected)
 */
export class StaleDataError extends Error {
  name: 'StaleDataError'
  originalError?: Error
  constructor(message: string, originalError?: Error)
}

/**
 * Error thrown when a bucket operation is not supported
 */
export class UnsupportedBucketOperationError extends Error {
  name: 'UnsupportedBucketOperationError'
  constructor(message: string)
}

/**
 * Create a new S3 store mock instance
 * @param bucket - The bucket name
 * @param options - Configuration options
 * @returns S3 store mock instance
 */
export default function createS3Store(bucket: string, options?: S3StoreOptions): S3StoreMock
