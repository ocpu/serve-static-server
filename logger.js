'use strict'

const colors = require('colors')

module.exports = (userAgent, method, statusCode, path) => {
  const browser = colors.cyan('(' + getBrowserFromAgent(userAgent) + ')')
  const status = colors[
    status >= 400 ? 'red' :
    status >= 300 ? 'blue' :
    'green'
  ](status)
  console.log(`[${browser} ${colors.magenta(method)}/${status}] ${colors.underline(path)}`)
}

const getBrowserFromAgent = agent => 
  ~agent.indexOf('Chrome') ? 'Chrome' :
  ~agent.indexOf('Safari') ? 'Safari' :
  ~agent.indexOf('Firefox') ? 'Firefox' :
  ~agent.indexOf('Edge') ? 'Egde' :
  ~agent.indexOf('MSIE') ? 'Internet Explorer' :
  'Undefined'
