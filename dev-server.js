#!/usr/bin/env node
if (process.argv[2] === '-h' || process.argv[2] === '-help' || process.argv[2] === '--help') {
    console.log(`
Usage: ds [--help | -help | -h] [-v | -version | --version] [<args>] <static serve point>

args:
    -p,-port,--port     The port to use when serving

<static serve point> can be omitted to use current working directory
`)
    process.exit(0)
}
if (process.argv.length === 3 && (process.argv[2] === '-v' || process.argv[2] === '-version' || process.argv[2] === '--version')) {
    console.log(`${require('./package.json').version}`)
    process.exit(0)
}

var hasPortArg = ~process.argv.indexOf('-p') ?
    process.argv.indexOf('-p') + 1 :
    ~process.argv.indexOf('-port') ?
        process.argv.indexOf('-pprt') + 1 :
        ~process.argv.indexOf('--port') ?
            process.argv.indexOf('--port') + 1 :
            void 0

var port = hasPortArg ? process.argv[hasPortArg] : 5000

var servePoint = hasPortArg ? process.argv[hasPortArg + 1] || process.cwd() : process.argv[2] || process.cwd()
var express = require('express')
var app = express().use(express.static(servePoint))
var addresses = discoverLocalAdresses()
function setup(port) {
    require('http').createServer(app).listen(port).once('listening', function () {
        console.log(`Serving ${servePoint} on http://127.0.0.1:${port}`)
        addresses.forEach(function (address) {
            require('http').createServer(app).listen(port, address).once('listening', function () {
                console.log(`Serving ${servePoint} on http://${address}:${port}`)    
            })
        })
    }).once('error', function (err) {
        if (err.code === 'EADDRINUSE')
            setup(port + 1)
        else {
            console.error(err)
            process.exit(1)
        }
    })
}

setup(port)

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
