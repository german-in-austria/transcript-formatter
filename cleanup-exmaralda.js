
var _ = require('underscore')
var xml2js = require('xml2js')
var fs = require('fs')

var parseXML = (string) => {
  return new Promise((resolve, reject) => {
    xml2js.parseString(string, (err, res) => {
      if (err == null) {
        resolve(res)
      }else{
        reject(err)
      }
    })
  })
}
var buildXML = (obj) => {
  return new Promise((resolve, reject) => {
    var builder = new xml2js.Builder()
    try {
      resolve(builder.buildObject(obj))
    }catch (e){
      reject(e)
    }
  })
}
var writeXML = (path, data) => {
  return new Promise((resolve, reject) => {
    fs.writeFile(path, data, (err) => {
      if (err == null) {
        resolve(true)
      }else{
        reject(err)
      }
    })
  })
}

var substitute = {
  pauses : (string) => {
    var regex_pause = /\[(\d{1,},?\d{0,}s)\]/g
    var res
    while(res = regex_pause.exec(string)){
      var old_format = res[0]
      var new_format = `(${
        res[1]
          .replace('s','')
          .replace(',', '.')
        }${(
          res[1].indexOf(',') > -1 ? '' : '.0')})`
      string = string.replace(old_format, new_format)
      // console.log('TIMESTAMP', res)
      // console.log('=>', string)
    }
    return string
  },
  delimiters : (string) => {
    var regex_delimiter = /\D([\.,?])\s/g
    var res
    while(res = regex_delimiter.exec(string)){
      string = string.slice(0, res.index+1) + string.slice(res.index+2)
      // console.log('res', res)
    }
    return string
  },
  contractons : (string) => {
    return string
      .split('-').join('_')
  },
  brackets : (string) => {
    return string
      .split('(').join('')
      .split(')').join('')
  },
  paraverbal : (string) => {
    var regex_paraverbal = /\[(\D.{1,}?)\]/g
    var res
    while(res = regex_paraverbal.exec(string)){
      var old_format = res[0]
      var new_format = `((${ res[1] }))`
      string = string.replace(old_format, new_format)
      // console.log('TIMESTAMP', res)
      // console.log('=>', string)
    }
    return string
  },
  commas : (string) => {
    return string.split(',').join('')
  }
}

var cGATmin = (string) => {
  string = string
    .trimLeft()
    // incomprehensible tokens
    .split('(?)').join('+++')
    // cancellations
    .split('/').join('')
    // meaning?
    .split('{').join('')
    .split('}').join('')
    // whitespace consolidation
    .split('  ').join(' ')
    .replace(/ +(?= )/g,'')
    // lowercase
    .toLowerCase()
  string = substitute.brackets(string)
  string = substitute.delimiters(string)
  string = substitute.pauses(string)
  string = substitute.contractons(string)
  string = substitute.paraverbal(string)
  string = substitute.commas(string)
  return string
}


var cleanFile = (path) => {
  var file = fs.readFileSync(path).toString()
  return parseXML(file)
  .then(tree => {
    var tiers = _(tree['basic-transcription']['basic-body'][0].tier)
      .chain()
      // remove commentary track
      .filter(t => t.$.category != 'c')
      // process speech
      .map(speaker => {
        speaker.event = _(speaker.event).map((e,i) => {
          if (speaker.event && speaker.event[i+1] && speaker.event[i+1]._ && speaker.event[i+1]._[0] == '-') {
            e._ = e._.trim()
          }
          if (e._ !== undefined) {
            e._ = cGATmin(e._)
          }
          return e
        })
        return speaker
      })
      .value()
    // console.log(require('util').inspect(tiers, { depth: null }))
    return buildXML(tree)
  })
  .then((xml) => {
    return writeXML(path + 'exmaralda-clean.xml', xml)
  })
  .then(() => {
    console.log('yo. done.')
    return { ok : true }
  })
}


var paths = fs.readdirSync(__dirname + '/files/_wip')
  .filter(p => {
    return p.indexOf('.exb') > -1 && !(p.indexOf('xml') > -1)
  })
  .map(p => (__dirname + '/files/_wip/' + p))

console.log('paths', paths)

// run.
Promise.all(paths.map(p => {
  return cleanFile(p)
}))
.then((ress) => {
  // console.log('ress', ress)
  console.log('yoyoyo.')
})



process.on('unhandledRejection', (error, promise) => {
  console.error('UNHANDLED REJECTION', error.stack) })
