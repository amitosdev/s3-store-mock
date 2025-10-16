# s3-store-mock

A mock implementation of [@kessler/s3-store](https://github.com/kessler/s3-store) that uses the local file system instead of AWS S3.

## About

This package provides a drop-in replacement for `@kessler/s3-store` that stores data in local files instead of S3. Perfect for testing, local development, or offline work.

## Installation

```bash
npm install s3-store-mock @kessler/s3-store
```

Note: `@kessler/s3-store` is required as a peer dependency for the JSON wrapper functionality.

## Usage

```javascript
import createS3Store from 's3-store-mock'
import { createJsonWrapper } from '@kessler/s3-store'

// Create a store (stores files in .s3StoreMock/my-bucket/ by default)
const store = createS3Store('my-bucket')

// Or specify a custom directory
const store = createS3Store('my-bucket', { mockDir: './my-custom-mock-dir' })

// Use the JSON wrapper for automatic JSON serialization
const jsonStore = createJsonWrapper(store)

// Create an object
const etag = await jsonStore.createObject('my-key', { hello: 'world' })

// Get an object
const [data, etag] = await jsonStore.getObject('my-key')
console.log(data) // { hello: 'world' }

// Update with etag
const newEtag = await jsonStore.putObjectIfMatch('my-key', { hello: 'universe' }, etag)

// Delete an object
await store.deleteObject('my-key')

// List objects
for await (const objects of store.list('prefix/')) {
  console.log(objects)
}
```

## API

This mock implements the same API as [@kessler/s3-store](https://github.com/kessler/s3-store):

- `createObject(key, body, contentType)` - Create a new object (fails if key exists)
- `putObjectIfMatch(key, body, etag, contentType)` - Update object with etag validation
- `getObject(key)` - Get object without etag check
- `getObjectIfMatch(key, etag)` - Get object with etag validation
- `deleteObject(key)` - Delete object
- `deleteObjectIfMatch(key, etag)` - Delete object with etag validation
- `list(prefix)` - Async iterator for listing objects

## Testing

```bash
npm test
```

## How It Works

- Files are stored in `.s3StoreMock/{bucket}/{key}` by default
- ETags are calculated using MD5 hashes
- Metadata (ETags, content type) is stored in `.meta` files alongside the data files
- All the same errors are thrown (`KeyExistsError`, `StaleDataError`, etc.)

## Original Module

This is a mock implementation of [@kessler/s3-store](https://github.com/kessler/s3-store). For production use with real AWS S3, please use the original module.

## License

Apache-2.0
