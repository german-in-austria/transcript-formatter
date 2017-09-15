
var _ = require('lodash')
var xml2js = require('xml2js')
var fs = require('fs')
var originalXML = fs.readFileSync(__dirname + '/data/original/01_LE_V2.exb').toString()
var orthographicXML = fs.readFileSync(__dirname + '/data/ortho/01_LE_V2.fln').toString()
var db = require('./dao/tokens')

var log = (obj, len = 100) => {
  return require('util').inspect(obj, {
    depth          : null,
    maxArrayLength : len
  })
}

var x = new xml2js.Parser({
  explicitArray         : false,
  preserveChildrenOrder : true,
  mergeAttrs            : false,
  explicitChildren      : true
})

// console.log('x',x)

var parseXML = (string) => {
  return new Promise((resolve, reject) => {
    x.parseString(string, (err, res) => {
      if (err == null) {
        resolve(res)
      }else{
        reject(err)
      }
    })
  })
}

var clone = (obj) => JSON.parse(JSON.stringify(obj))

var isWordToken = (t) => {
  return t.text  != '.'
    && t.text    != ','
    && t.text[0] != ','
    && t.text    != '?'
    && t.text[0] != "["
    && t.text[0] != "("
    && !t.fragment_of
}

var tokenizeFragment = (sentence_fragment) => {
  // TODO: THIS IS IMPROPPER
  return sentence_fragment
    .split('.')
    .join(' .')
    .split(',')
    .join(' ,')
    .split('-')
    .join(' ')
    .split('? ')
    .join(' ? ')
    .split(' ')
    .filter(t => t != '')
}

// START

Promise.all([
  parseXML(originalXML),
  parseXML(orthographicXML)
])
.then(([original, orthographic]) => {

  var cs = _(orthographic['folker-transcription'].$$).filter({'#name' : 'contribution'}).value()

  var cs_by_start_reference_and_speaker = _(cs).groupBy((c) => {
    return `${c.$['speaker-reference']}-${c.$['start-reference']}`
  }).value()

  var cs_by_speaker = _(cs).groupBy((c) => {
    return `${c.$['speaker-reference']}`
  }).value()

  var tiers_with_comments = _(original['basic-transcription'].$$)
    .filter({ '#name' : 'basic-body' }).value()[0].tier

  var tiers = tiers_with_comments.filter(t => t.$.category != 'c')

  var parseEvent = (e, l, i, carry_over = null) => {
    e.tokens = tokenizeFragment(e._)
    e.tokens = e.tokens.map((t, ti) => {
      return {
        text  : t,
        start : ti == 0 ? e.$.start : null,
        end   : ti+1 == e.tokens.length ? e.$.end : null
      }
    })
    if (carry_over) {
      console.log('carry_over, e._', carry_over, e.tokens)
    }

  // it’s an uninterrupted event => return
    if (e._.slice(-1) === ' '){
      return clone(e)

  // it’s interrupted (i.e. the last word is incomplete)
  // => descend into next event, and apend its text
  // to the current token text
    }else{
      // console.log('tokens', e.tokens)
      e.tokens = e.tokens.map((token, ti) => {
        if (ti+1 == e.tokens.length) {
          var next           = parseEvent(l[i+1], l, i+1)
          l[i+1].skip_first  = true
          // console.log('next first token', next.tokens[0])
          e.next_token       = next
          l[i+1].fragment_of = i
          token.text         = token.text + next.tokens[0].text
          return token
        }else{
          return token
        }
      })
      return clone(e)
    }
  }


  var orthographic_words_only = _(cs_by_speaker.BZ).reduce((m,e,i,l) => {
    return m.concat(e.w)
  }, [])

  var joinEvents = (events) => {
    return _(events).reduce((m, e, i, l) => {
      var parsed = parseEvent(e, events, i)
      return m.concat(parsed)
    }, [])
  }

  var events_1 = joinEvents(tiers[0].event)

  // EXTRACT TOKENS FROM EVENTS
  var ti = 0 // token index
  var tokens = _(events_1).reduce((m, e, i, l) => {
    return m.concat(_(e.tokens).map((t,j) => {
      var ortho = t.start ? (cs_by_start_reference_and_speaker[`BZ-TLI_${Number(t.start.substring(1))-1}`] || null) : null
      return {
        fragment_of : e.fragment_of && j == 0 ? ti : null,
        token_id    : ti+=1,
        event_id    : i,
        text        : t.text,
        start       : t.start,
        end         : t.end,
        ortho       : ortho,
        // ortho_by_timepoints : ortho && _(ortho[0].$$).reduce((m,e,i,l) => {
        //   return m.concat((() => {
        //     if (e.$ && e.$['timepoint-reference']) {
        //       return e.$['timepoint-reference']
        //     }else{
        //       return
        //     }
        //   })())
        // }, []).value()
      }
    }).value())
  }, [])

  var [tokens_words_only, tokens_non_words] = clone(_.partition(tokens, isWordToken))

  // ANOTHER APROACH:
  // two flat lists of original tokens
  // that only contains the set of tokens
  // that is also in the orthographic translation
  // => downside: any differences in tokenization
  // lead to a will have more consequential errors

  var word_tokens_with_normalized_spelling = _(tokens_words_only).map((token, i) => {
    token.ortho_by_index = orthographic_words_only[i]
    if (token.ortho && token.ortho[0].w) {
      token.normalized = ( token.ortho[0].w[0] || token.ortho[0].w ).$.n || null
      if (Array.isArray(token.ortho[0].w)) {
        // SIDE EFFECT: modify next token until
        // we’re out of normalized words in this segment.
        _.each(token.ortho[0].w, (t,j) => {
          if (tokens_words_only[i+j]) {
            tokens_words_only[i+j].normalized = t.$.n || null
            if (t.$.transition) {
              tokens_words_only[i+j].is_assimilated = true
            }
            if (tokens_words_only[i+j].text != t._) {
              tokens_words_only[i+j].original_changed = true
            }
          }
        })
      }
    }
    return token
  }).value()

  var all_tokens_with_normalized_spelling = _(word_tokens_with_normalized_spelling)
    .concat(tokens_non_words)
    .sortBy('event_id')
    .map((t,i) => ({
      fragment_of            : t.fragment_of,
      token_id               : t.token_id,
      event_id               : t.event_id,
      text                   : t.text,
      start                  : t.start,
      end                    : t.end,
      normalized             : t.normalized,
      is_assimilated         : t.is_assimilated,
      original_changed       : t.original_changed || null,
      // ortho                  : t.ortho,
      ortho_by_index         : (t.ortho_by_index ? t.ortho_by_index._ : null),
      ortho_by_index_changed : (t.ortho_by_index ? t.ortho_by_index._ != t.text : null)
    }))
    .sortBy('token_id')
    .value()


  // console.log('original_words_only', tokens_words_only)
  // console.log('orthographic_words_only', orthographic_words_only)
  console.log('tokens', log(_(tokens).groupBy('event_id').value()))
  // console.log('all_tokens_with_normalized_spelling', log(all_tokens_with_normalized_spelling, 1950))
  // console.log('cs_by_start_reference_and_speaker', log(cs_by_start_reference_and_speaker))
  // db.insertTokens(all_tokens_with_normalized_spelling)
  fs.writeFileSync('./log-orthographic.txt', JSON.stringify(orthographic, undefined, 2))
  fs.writeFileSync('./log-original.txt', JSON.stringify(original, undefined, 2))
  // console.log(require('util').inspect(orthographic['folker-transcription'].timeline, { depth: null }));
  console.log('done')
})

process.on('unhandledRejection', (err, promise) => {
  console.log(err, promise)
})
