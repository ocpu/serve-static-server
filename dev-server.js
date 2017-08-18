#!/usr/bin/env node
if (getOption('-v, -version, --version', process.argv)) {
    console.log(`${require('./package.json').version}`)
    process.exit(0)
}
if (getOption('-h, -help, --help', process.argv)) {
    console.log(`
    Usage: ds [options] [directory]

    Options:

        -h, --help          Show this help message.
        -v, --version       Show current version.
        -p, --port <port>   The port to use when serving.
        -f, --404 <file>    Show custom 404 page.
        -l, --only-local    Force to only serve on local device.
`)
    process.exit(0)
}

const file404 = getOption('-f, --404 <file>', process.argv)
const onlyLocal = getOption('-l, --only-local', process.argv)

// Get serve point and optional port
const port = getOption('-p, --port <port>', process.argv) || 5000
const servePoint = process.argv.length === 3 ? require('path').resolve(process.argv[2]) : process.cwd()
const path = require('path')
const fs = require('fs')
const extToMime = require('./extToMime.json')

const app = (req, res) => {
    const url = require('url').parse(req.url)
    let fileToServe = servePoint + url.pathname.replace(/\//g, path.sep)
    if (fileToServe.endsWith(path.sep))
        fileToServe += 'index.html'
    try {
        serveFile(fileToServe, res)
    } catch (e) {
        if (file404) {
            try {
                serveFile(file404, res)
            } catch (e) {
                switch (e.code) {
                    case'ENOENT':
                        console.error(`404 file not found (${path.resolve(file404)})`)
                        break
                    default:
                        console.error(e)
                }
                serveNotFound(req, res)
            }
        } else {
            console.error(e)
            serveNotFound(req, res)
        }
    }
}

function serveFile(file, res) {
    const { size } = fs.statSync(file)
    const smallBuffer = Buffer.alloc(20)
    fs.readSync(fs.openSync(file, 'r'), smallBuffer, 0, smallBuffer.length, 0)
    const fileType = require('file-type')(smallBuffer)
    const mime = getMimeType(file)
    if (mime)
        res.setHeader('content-type', mime)
    res.setHeader('content-length', size)
    res.statusCode = 200
    res.statusMessage = "OK"
    fs.createReadStream(file).pipe(res)
}

function serveNotFound(req, res) {
    const content = new Buffer(`Cannot ${req.method} ${req.url}`)
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.setHeader('content-length', content.byteLength)
    res.statusCode = 404
    res.statusMessage = 'Not Found'
    res.end(content)
}

function getMimeType(file) {
    const smallBuffer = Buffer.alloc(20)
    fs.readSync(fs.openSync(file, 'r'), smallBuffer, 0, smallBuffer.length, 0)
    const fileType = require('file-type')(smallBuffer)
    return fileType ? fileType.mime : extToMime[path.extname(file)] || ''
}

const addresses = ['127.0.0.1']
if (!onlyLocal) Array.prototype.push.apply(addresses, discoverLocalAdresses())

const logListen = callAfter(addresses.length, () => {
    console.log(`Serving ${servePoint} on [ ${addresses.map(({ address, port }) => `http://${address}:${port}`).join(', ')} ]`)
})

addresses.forEach(function (address, index) {
    getPort(address, port, port => {
        require('http').createServer(app).listen(port, address).once('listening', function () {
            addresses[index] = {
                address,
                port
            }
            logListen()
        })
    })
})

function getPort(address, port, cb) {
    const server = require('http').createServer()
    server.once('listening', onListen)
    server.once('error', onError)
    server.listen(port, address)

    function onListen() {
        server.close()
        cb(port)
    }
    
    function onError() {
        server.removeAllListeners()
        server.close()
        getPort(port + 1, cb)
    }
}

function discoverLocalAdresses() {
    var os = require('os');
    var interfaces = os.networkInterfaces()
    var addresses = []
    for (var k in interfaces) {
        for (var k2 in interfaces[k]) {
            var address = interfaces[k][k2]
            if (address.family === 'IPv4' && !address.internal) {
                addresses.push(address.address)
            }
        }
    }
    return addresses
}

function getOption(flags, args) {
    const _flags = flags.split(/,\s?/g)
    const hasValue = /\s<(\w+)>$/g.test(_flags[_flags.length - 1])
    _flags[_flags.length - 1] = _flags[_flags.length - 1].split(/\s/)[0]
    let index = -1
    let length = args.length
    while ((length--) > 0 && index === -1) if (~_flags.indexOf(args[length])) index = length
    if (~index) {
        if (!hasValue) {
            args.splice(index, 1)
            return true
        }
        return args.splice(index, 2)[1]
    }
    if (!hasValue) return false
}

function callAfter(times, cb) {
    let calls = 0
    return function () {
        calls++
        if (calls >= times)
            cb()
    }
}