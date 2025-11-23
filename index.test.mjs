import fs from 'node:fs/promises'
import path from 'node:path'
import { createJsonWrapper } from '@kessler/s3-store'
import test from 'ava'
import createS3Store from './index.mjs'

const MOCK_DIR = '.s3StoreMockTest'
test('create and update and get', async (t) => {
  const bucket = t.context.bucket
  const store = createS3Store(bucket, { mockDir: MOCK_DIR })

  const testObject = { hello: 'world' }
  const key = 'test-object'
  const contentType = 'application/json'

  // Create object
  const createResult = await store.createObject(key, JSON.stringify(testObject), contentType)

  t.truthy(createResult.etag, 'etag should be returned after creating object')
  t.truthy(createResult.response, 'response should be returned after creating object')

  const testObject1 = { ...testObject, updated: true }

  // Update object
  const putResult = await store.putObjectIfMatch(key, JSON.stringify(testObject1), createResult.etag, contentType)

  // Get object with ETag
  const getResult = await store.getObjectIfMatch(key, putResult.etag)
  t.is(getResult.etag, putResult.etag, 'etag should match after getting the updated object')

  const actualObject = await getResult.asJson()

  t.deepEqual(actualObject, testObject1, 'object should match after getting the updated object')
})

test('create twice', async (t) => {
  const bucket = t.context.bucket
  const store = createS3Store(bucket, { mockDir: MOCK_DIR })

  const body = JSON.stringify({ hello: 'world' })
  const key = 'test-object'
  const contentType = 'application/json'

  // Create object
  const createResult1 = await store.createObject(key, body, contentType)
  t.truthy(createResult1.etag, 'etag should be returned after creating object the first time')

  // Try to create the same object again
  await t.throwsAsync(() => store.createObject(key, body, contentType), {
    name: 'KeyExistsError',
    message: 'cannot overwrite an existing key'
  })
})

test('stale object', async (t) => {
  const bucket = t.context.bucket
  const store = createS3Store(bucket, { mockDir: MOCK_DIR })

  const key = 'test-object'
  const body = JSON.stringify({ hello: 'world' })
  const contentType = 'application/json'

  // Create object
  const createResult = await store.createObject(key, body, contentType)

  const staleEtag = createResult.etag

  // Update object to change its ETag
  const updatedBody = JSON.stringify({ hello: 'universe' })
  await store.putObjectIfMatch(key, updatedBody, createResult.etag, contentType)

  // Try to update the object with the stale ETag
  await t.throwsAsync(() => store.putObjectIfMatch(key, body, staleEtag, contentType), {
    name: 'StaleDataError',
    message: 'object was modified concurrently, reload your object first'
  })
})

test('get object without etag', async (t) => {
  const bucket = t.context.bucket
  const store = createS3Store(bucket, { mockDir: MOCK_DIR })

  const key = 'test-object'
  const body = JSON.stringify({ hello: 'world' })
  const contentType = 'application/json'

  // Create object
  await store.createObject(key, body, contentType)

  // Get object without ETag
  const getWithoutEtag = await store.getObject(key)
  const getBody = await getWithoutEtag.asString()

  t.deepEqual(getBody, body, 'body should match after getting object without etag')
})

test('delete object', async (t) => {
  const bucket = t.context.bucket
  const store = createS3Store(bucket, { mockDir: MOCK_DIR })

  const key = 'test-object'
  const body = JSON.stringify({ hello: 'world' })
  const contentType = 'application/json'

  // Create object
  const createResult = await store.createObject(key, body, contentType)

  // Delete object
  const deleteResult = await store.deleteObject(key, createResult.etag)

  t.truthy(deleteResult.response, 'response should be returned after deleting object')

  // Try to get deleted object
  await t.throwsAsync(() => store.getObjectIfMatch(key, deleteResult.etag), {
    name: 'NoSuchKey',
    message: 'The specified key does not exist.'
  })
})

test('createJsonWrapper, create and get if match', async (t) => {
  const bucket = t.context.bucket
  const store = createS3Store(bucket, { mockDir: MOCK_DIR })
  const jsonWrapper = createJsonWrapper(store)

  const key = 'test-json-object'
  const body = { hello: 'json world' }

  // Create object using JSON wrapper
  const createTag = await jsonWrapper.createObject(key, body)

  t.truthy(createTag, 'etag should be returned after creating object with JSON wrapper')

  // Get object using JSON wrapper
  const getResponse = await jsonWrapper.getObjectIfMatch(key, createTag)
  t.deepEqual(getResponse, body, 'body should match after getting object with JSON wrapper')
})

test('custom basePath - create and get', async (t) => {
  const bucket = t.context.bucket
  const customBasePath = path.join(process.cwd(), 'custom-base-path-test')
  const store = createS3Store(bucket, { mockDir: MOCK_DIR, basePath: customBasePath })

  const testObject = { test: 'custom base path' }
  const key = 'test-object'
  const contentType = 'application/json'

  // Create object
  const createResult = await store.createObject(key, JSON.stringify(testObject), contentType)
  t.truthy(createResult.etag, 'etag should be returned')

  // Verify file exists in custom base path
  const expectedFilePath = path.join(customBasePath, MOCK_DIR, bucket, key)
  const fileExists = await fs.access(expectedFilePath).then(() => true).catch(() => false)
  t.true(fileExists, 'file should exist in custom base path')

  // Get object
  const getResult = await store.getObject(key)
  const actualObject = await getResult.asJson()
  t.deepEqual(actualObject, testObject, 'object should match')

  // Cleanup custom base path
  await fs.rm(customBasePath, { recursive: true, force: true })
})

test('default basePath uses process.cwd()', async (t) => {
  const bucket = t.context.bucket
  const store = createS3Store(bucket, { mockDir: MOCK_DIR })

  const testObject = { test: 'default path' }
  const key = 'test-object'
  const contentType = 'application/json'

  // Create object
  await store.createObject(key, JSON.stringify(testObject), contentType)

  // Verify file exists in default path (process.cwd())
  const expectedFilePath = path.join(process.cwd(), MOCK_DIR, bucket, key)
  const fileExists = await fs.access(expectedFilePath).then(() => true).catch(() => false)
  t.true(fileExists, 'file should exist in default path (process.cwd())')
})

test('list objects returns correct structure', async (t) => {
  const bucket = t.context.bucket
  const store = createS3Store(bucket, { mockDir: MOCK_DIR })

  // Create multiple objects
  await store.createObject('file1.json', JSON.stringify({ test: 1 }), 'application/json')
  await store.createObject('file2.json', JSON.stringify({ test: 2 }), 'application/json')
  await store.createObject('prefix/file3.json', JSON.stringify({ test: 3 }), 'application/json')

  // List all objects
  const allObjects = []
  for await (const objects of store.list()) {
    allObjects.push(...objects)
  }

  t.is(allObjects.length, 3, 'should list all 3 objects')

  // Verify structure of each object
  for (const obj of allObjects) {
    t.truthy(obj.Key, 'should have Key property')
    t.truthy(obj.LastModified, 'should have LastModified property')
    t.truthy(obj.ETag, 'should have ETag property')
    t.truthy(obj.Size, 'should have Size property')
    t.is(obj.StorageClass, 'STANDARD', 'should have StorageClass set to STANDARD')
    t.true(obj.ETag.startsWith('"') && obj.ETag.endsWith('"'), 'ETag should be wrapped in quotes')
    t.truthy(obj.Owner, 'should have Owner property')
    t.truthy(obj.Owner.DisplayName, 'should have Owner.DisplayName property')
    t.truthy(obj.Owner.ID, 'should have Owner.ID property')
  }

  // List with prefix
  const prefixObjects = []
  for await (const objects of store.list('prefix/')) {
    prefixObjects.push(...objects)
  }

  t.is(prefixObjects.length, 1, 'should list 1 object with prefix')
  t.is(prefixObjects[0].Key, 'prefix/file3.json', 'should match the correct key')
})

test.beforeEach(async (t) => {
  const bucket = `s3store-bucket-${randomString(10)}`
  t.context.bucket = bucket
  console.error('bucket created:', bucket)
})

test.afterEach.always(async (t) => {
  await cleanupBucket(t.context.bucket)
  console.error('bucket deleted:', t.context.bucket)
})

async function cleanupBucket(bucket) {
  const bucketPath = path.join(process.cwd(), MOCK_DIR, bucket)

  try {
    await fs.rm(bucketPath, { recursive: true, force: true })
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }
}

function randomString(length = 10) {
  return Math.random()
    .toString(36)
    .substring(2, length + 2)
}
