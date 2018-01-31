'use strict'

const { createGzip, createDeflate } = require('zlib')
const { promisify } = require('util')
const path = require('path')
const url = require('url')
const fs = require('fs')

const fileType = require('file-type')
const logger = require('./logger')
const mime = require('mime')

const read = promisify(fs.read)
const open = promisify(fs.open)
const stat = promisify(fs.stat)

module.exports = (root, file404) => async (req, res) => {
  // Get file to serve
  let file = root + url.parse(req.url).pathname.replace(/\//g, path.sep)
  // If the path ends with / or \ append index.html
  if (file.endsWith(path.sep))
    file += 'index.html'

  // Get the encoding and encoding stream from the accepted encodings
  // If client does not accept encodings; the stream encoding will then be the identity
  const [encoding, stream] = getAcceptedStreamAndPipe(res, req.headers['accept-encoding'])

  try {
    // Try to serve file

    const fileStats = await stat(file)

    // Test client cache
    const etag = await getETag(fileStats)
    if (etag === req.headers['if-none-match']) {
      res.statusCode = 304
      stream.end()
      return
    }

    res.statusCode = 200

    if (encoding === 'identity')
      res.setHeader('Content-Length', fileStats.size)

    res.setHeader('Content-Encoding', encoding)

    // Set mime type
    res.setHeader('Content-Type', await getMimeType(file))
    
    // Caching
    res.setHeader('ETag', etag)
    res.setHeader('Cache-Control', 'public, max-age=31536000')

    // As the same content varies depending on the accepted encodings
    res.setHeader('Vary', 'Accept-Encoding')

    fs.createReadStream(file).pipe(stream)
  } catch (e) {
    // If any errors...

    res.statusCode = 404

    try {
      // Try to serve custom 404 page
      const fileStats = await stat(file404)

      res.setHeader('Content-Encoding', encoding)
      if (encoding === 'identity')
        res.setHeader('Content-Length', fileStats.size)
      res.setHeader('Content-Type', await getMimeType(file404))

      fs.createReadStream(file404).pipe(stream)
    } catch (e2) {
      // Else serve the most minimal of pages

      // If we have not specified a custom 404 we do not want to error out that it does not exist
      if (typeof file404 !== 'undefined') {
        if (e2.code === 'ENOENT')
          console.error(`Could not find resource ${path.resolve(file)}`)
        else console.error(e2)
      }

      const content = new Buffer(`Cannot ${req.method} ${req.url}`)

      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.setHeader('Content-Encoding', encoding)
      if (encoding === 'identity')
        res.setHeader('Content-Length', content.length)

      stream.end(content)
    }
    
    // Log error to console
    if (e.code === 'ENOENT')
      console.error(`Could not find resource ${path.resolve(file)}`)
    else console.error(e)
  }

  logger(req.headers['user-agent'], req.method, res.statusCode, req.url)
}

const getAcceptedStreamAndPipe = (res, acceptedEncodings) => {
  const [encoding, stream] =
    ~acceptedEncodings.indexOf('gzip') ? ['gzip', createGzip] :
    ~acceptedEncodings.indexOf('deflate') ? ['deflate', createDeflate] :
    ['identity', res]

  if (stream !== res) stream.pipe(res)

  return [encoding, stream]
}

const getETag = async stats =>
  `${stats.mtime.getTime().toString(16)}-${stats.size.toString(16)}`

async function getMimeType(file) {
  // First pass
  const mimeType = mime.getType(file)
  if (mimeType) return mimeType

  // Second pass
  const smallBuffer = Buffer.alloc(20)
  const fd = await open(file, 'r')
  await read(fd, smallBuffer, 0, smallBuffer.length, 0)
  fs.close(fd)
  const type = fileType(smallBuffer)
  if (type) return type.mime

  // Default
  return 'text/plain'
}
