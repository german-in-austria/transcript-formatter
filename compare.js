const _ = require('lodash')
const xml2js = require('xml2js')
const fs = require('fs')
const originalXML = fs.readFileSync(__dirname + '/data/original/01_LE_V2.exb').toString()
const orthographicXML = fs.readFileSync(__dirname + '/data/ortho/01_LE_V2.fln').toString()
const db = require('./dao/tokens')

process.on('unhandledRejection', (err, promise) => {
  console.log(err, promise)
})

const log = (obj, len = 100) => {
  return console.log(require('util').inspect(obj, {
    depth          : null,
    maxArrayLength : len
  }))
}

const x = new xml2js.Parser({
  explicitArray         : false,
  preserveChildrenOrder : true,
  mergeAttrs            : false,
  explicitChildren      : true
})

// console.log('x',x)

const parseXML = (string) => {
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

const clone = obj => JSON.parse(JSON.stringify(obj))

const isWordToken = t => {
  return t.text  != '.'
    && t.text    != ','
    && t.text[0] != ','
    && t.text    != '?'
    && t.text[0] != "["
    && t.text[0] != "("
    && !t.fragment_of
}

const tokenizeFragment = sentence_fragment => {
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

const getContributionsByTimepoint = orthographic_transcript => {
  return _(orthographic_transcript['folker-transcription'].$$)
    .chain()
    .filter({'#name' : 'timeline'})
    .first()
    .get('$$')
    .groupBy(x => x.$['timepoint-id'])
    .mapValues(x => x[0].$['absolute-time'])
    .value()
}

const getContributionsBySpeakerAndStartTime = orthographic_transcript => {

  const timeline_by_timepoint = getContributionsByTimepoint(orthographic_transcript)

  const cs = _(orthographic_transcript['folker-transcription'].$$)
    .chain()
    .filter({'#name' : 'contribution'})
    .map(x => {
      // add absolute time to contribution
      x.$.startTimepoint = timeline_by_timepoint[x.$['start-reference']]
      x.$.endTimepoint   = timeline_by_timepoint[x.$['end-reference']]
      x.$$ = _(x.$$)
        .map(x => {
          // add absolute time to time-markers inside contributions
          if (x['#name'] == 'time') {
            x.$._timepoint = timeline_by_timepoint[x.$['timepoint-reference']]
          }
          return x
        })
        .value()
      return x
    })
    .value()

  // log(cs_by_start_reference_and_speaker)

  const cs_by_start_timepoint_and_speaker = _(cs).groupBy((c) => {
    return `${c.$['speaker-reference']}-${c.$.startTimepoint}`
  }).value()

  // log(cs_by_start_timepoint_and_speaker)
  return cs_by_start_timepoint_and_speaker
}

const getOriginalTimelineByTLI = original => {
  const timeline = _(original['basic-transcription'].$$)
    .filter({ '#name' : 'basic-body' })
    .value()[0]['common-timeline'].$$
    const timeByTimepoint = _(timeline).groupBy(x => {
      return x.$.id
    })
    .mapValues(x => x[0].$.time)
    .value()
  return timeByTimepoint
}

const getTiers = original => {
  const tiers_with_comments = _(original['basic-transcription'].$$)
    .filter({ '#name' : 'basic-body' })
    .value()[0].tier

  const tiers = tiers_with_comments.filter(t => t.$.category != 'c')
  return tiers
}

// START

Promise.all([
  parseXML(originalXML),
  parseXML(orthographicXML)
])
.then(([original, orthographic]) => {

  var orthoByTimepoint = getContributionsByTimepoint(orthographic)

  var originalTimelineByTLI = getOriginalTimelineByTLI(original)

  var orthoBySpeakerAndStartTime = getContributionsBySpeakerAndStartTime(orthographic)

  var originalTiers = getTiers(original)

  // log(orthoByTimepoint)

  var parseEvent = (e, l, i) => {
    // not parsed yet:
    if (!e.tokens) {
      e.event_text = clone(e._)
      e.tli_start  = e.$.start
      e.tli_end    = e.$.end
      e.tokens     = tokenizeFragment(e.event_text)
      e.tokens     = _(e.tokens).map((t, ti) => {
        // console.log('t fragment_of',t.fragment_of)
        return {
          text            : t,
          // start           : ti == 0 ? e.$.start : null,
          startTimepoint : ti == 0 && e.$.start ? originalTimelineByTLI[e.$.start] : null,
          endTimepoint   : ti+1 == e.tokens.length && e.$.end ? originalTimelineByTLI[e.$.end] : null,
          // end             : ti+1 == e.tokens.length ? e.$.end : null,
          fragment_of     : t.fragment_of || null
        }
      })
      .value()
      delete e._
      delete e.$
    // already parsed (via lookahead)
    }else{
      return clone(e)
    }

    // the event ends with a whitespace => the last token is not interrupted/split between events
    // => return tokenized event
    if (e.event_text.slice(-1) === ' '){
      return clone(e)

    // it’s interrupted (i.e. the last word is incomplete)
    // => descend into next event, and apend its text
    // to the current token text
    }else{
      e.tokens = e.tokens.map((token, ti) => {
        // console.log('ti+1',ti+1,'interrupted', e.tokens.length, e.tokens, 'l[i+1]',l[i+1])
        // the last event token
        if (ti+1 == e.tokens.length) {
          // console.log('hello')
          var next                     = parseEvent(l[i+1], l, i+1)
          l[i+1].skip_first            = true
          e.next_token                 = next.tokens[0]
          l[i+1].tokens[0].fragment_of = i
          token.text                   = token.text + next.tokens[0].text
          console.log('l[i+1].tokens[0].fragment_of',i+1,l[i+1].tokens[0].fragment_of);
          return token
        }else{
          return token
        }
      })
      return clone(e)
    }
  }

  // var orthographic_words_only = _(cs_by_speaker.MF).reduce((m,e,i,l) => {
  //   return m.concat(e.w)
  // }, [])
  //
  const joinEvents = (events) => {
    return _(events).reduce((m, e, i, l) => {
      var parsed = parseEvent(e, events, i)
      return m.concat(parsed)
    }, [])
  }

  const originalEventTokensBySpeaker = _(originalTiers).map(tier => {
    return {
      speaker : tier.$['display-name'],
      events  : joinEvents(tier.event)
    }
  }).value()

  // log(originalEventTokensBySpeaker)

  // EXTRACT TOKENS FROM EVENTS (ONE SPEAKER)
  var ti = 0 // token index
  var tokens = _(originalEventTokensBySpeaker[0].events).reduce((m, e, i, l) => {
    return m.concat(_(e.tokens).map((t,j) => {
      var ortho = t.startTimepoint ? orthoBySpeakerAndStartTime[`MF-${t.startTimepoint}`] : null
      return {
        fragment_of     : t.fragment_of && j == 0 ? ti : null,
        token_id        : ti+=1,
        event_id        : i,
        text            : t.text,
        start           : t.start || null,
        end             : t.end || null,
        startTimepoint  : t.startTimepoint,
        endTimepoint    : t.endTimepoint,
        ortho           : ortho,
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

  log(tokens)
  //
  // var [tokens_words_only, tokens_non_words] = clone(_.partition(tokens, isWordToken))
  //
  // // ANOTHER APROACH:
  // // two flat lists of original tokens
  // // that only contains the set of tokens
  // // that is also in the orthographic translation
  // // => downside: any differences in tokenization
  // // lead to a will have more subsequent errors
  //
  // var word_tokens_with_normalized_spelling = _(tokens_words_only).map((token, i) => {
  //   token.ortho_by_index = orthographic_words_only[i]
  //   if (token.ortho && token.ortho[0].w) {
  //     token.normalized = ( token.ortho[0].w[0] || token.ortho[0].w ).$.n || null
  //     if (Array.isArray(token.ortho[0].w)) {
  //       // SIDE EFFECT: modify next token until
  //       // we’re out of normalized words in this segment.
  //       _.each(token.ortho[0].w, (t,j) => {
  //         if (tokens_words_only[i+j]) {
  //           tokens_words_only[i+j].normalized = t.$.n || null
  //           if (t.$.transition) {
  //             tokens_words_only[i+j].is_assimilated = true
  //           }
  //           if (tokens_words_only[i+j].text != t._) {
  //             tokens_words_only[i+j].original_changed = true
  //           }
  //         }
  //       })
  //     }
  //   }
  //   return token
  // }).value()


  // var all_tokens_with_normalized_spelling = _(word_tokens_with_normalized_spelling)
  //   .concat(tokens_non_words)
  //   .sortBy('event_id')
  //   .map((t,i) => ({
  //     fragment_of            : t.fragment_of,
  //     token_id               : t.token_id,
  //     event_id               : t.event_id,
  //     text                   : t.text,
  //     start                  : t.start,
  //     end                    : t.end,
  //     normalized             : t.normalized,
  //     is_assimilated         : t.is_assimilated,
  //     original_changed       : t.original_changed || null,
  //     ortho                  : t.ortho,
  //     ortho_by_index         : (t.ortho_by_index ? t.ortho_by_index._ : null),
  //     ortho_by_index_changed : (t.ortho_by_index ? t.ortho_by_index._ != t.text : null)
  //   }))
  //   .sortBy('token_id')
  //   .value()

  // log(all_tokens_with_normalized_spelling)
  //
  // // console.log('original_words_only', tokens_words_only)
  // // console.log('orthographic_words_only', orthographic_words_only)
  // console.log('tokens:');
  // log(word_tokens_with_normalized_spelling)
  // console.log('all_tokens_with_normalized_spelling', log(all_tokens_with_normalized_spelling, 1950))
  // console.log('cs_by_start_reference_and_speaker', log(cs_by_start_reference_and_speaker))
  // db.insertTokens(all_tokens_with_normalized_spelling)
  // fs.writeFileSync('./log-orthographic.txt', JSON.stringify(orthographic, undefined, 2))
  // fs.writeFileSync('./log-original.txt', JSON.stringify(original, undefined, 2))
  // console.log(require('util').inspect(orthographic['folker-transcription'].timeline, { depth: null }));
  console.log('done')
})
