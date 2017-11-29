
declare var __dirname
declare var process

import * as _      from 'lodash'
import * as xml2js from 'xml2js'
import * as fs     from 'fs'
import * as util   from 'util'
import * as path   from 'path'

import dao         from './dao/tokens'

// catch unhandled rejections
process.on('unhandledRejection', (err, promise) => {
  console.log(err, promise)
})

const log = (obj, len = 100) => {
  return console.log(require('util').inspect(obj, {
    depth          : null,
    maxArrayLength : len
  }))
}

const sanitizeXMLString = (string) => {
  return string
    .split('/<').join('/ <')
    .split(',<').join(', <')
    .split('?<').join('? <')
    .split('.<').join('. <')
    .split(')<').join(') <')
    .split(']<').join('] <')
    .split('][').join('] [')
    .split(')[').join(') [')
}

const parser = new xml2js.Parser({
  explicitArray         : false,
  preserveChildrenOrder : true,
  mergeAttrs            : false,
  explicitChildren      : true
})

const parseXML = (string) => {
  var fixed = sanitizeXMLString(string)
  return new Promise((resolve, reject) => {
    parser.parseString(fixed, (err, res) => {
      if (err == null) {
        resolve(res)
      }else{
        reject(err)
      }
    })
  })
}

const clone = obj => {
  if (obj !== undefined) {
    return JSON.parse(JSON.stringify(obj))
  }else{
    return undefined
  }
}

const isWordToken = t => {
  return t.text    != '.'
    && t.text    != ','
    && t.text[0] != ','
    && t.text    != '?'
    && t.text[0] != "["
    && t.text[0] != "("
    && !t.fragment_of
}

const tokenizeFragment = (sentence_fragment) => {
  return sentence_fragment
    .split('.').join(' .')
    .split(', ').join(' , ')
    // tokens from assimilations
    .split('-').join(' ')
    .split('? ').join(' ? ')
    // corrects mistakes where transcribers didn’t
    // put a space after the comma *within* an event.
    .split(/(?=\D\b)(,)(?=\b\D)/).filter(x => x !== ',').join(', ')
    // corrects mistakes where transcribers didn’t
    // put a space after the comma *at the end* of an event.
    .split(/,$/).join(', ')
    .split(' ')
    .filter(t => t != '')
}

const TOKEN_TYPES = {
  unknown : {
    id : 1
  },
  delimitier : {
    regex : /(\?|\.|\!|\,)/,
    id : 2
  },
  pause : {
    id : 3,
    regex : /\[[\s\S]{1,}s\]/g
  },
  proper_name : {
    id : 4,
    regex : /\{.{1,}\}/
  },
  non_verbal : {
    id : 5,
    regex : /\[[\D]{1,}\]/
  }
}

const getTokenTypeFromToken = (text:string):number => {
  if(text.match(TOKEN_TYPES.pause.regex) !== null){
    return TOKEN_TYPES.pause.id
  } else if (text.match(TOKEN_TYPES.delimitier.regex) !== null) {
    return TOKEN_TYPES.delimitier.id
  } else if(text.match(TOKEN_TYPES.proper_name.regex) !== null){
    return TOKEN_TYPES.proper_name.id
  } else if(text.match(TOKEN_TYPES.non_verbal.regex) !== null){
    return TOKEN_TYPES.non_verbal.id
  }else{
    return TOKEN_TYPES.unknown.id
  }
}

const getContributionsBySpeakerAndStartTime = orthographic_transcript => {

  const timeline_by_timepoint = _(orthographic_transcript['folker-transcription'].$$)
    .chain()
    .filter({'#name' : 'timeline'})
    .first()
    .get('$$')
    .groupBy(x => x.$['timepoint-id'])
    .mapValues(x => x[0].$['absolute-time'])
    .value()

  const cs = _(orthographic_transcript['folker-transcription'].$$)
    .chain()
    .filter({'#name' : 'contribution'})
    .map(x => {
      // add absolute time to contribution
      x.$.startTimepoint = timeline_by_timepoint[x.$['start-reference']]
      x.$.endTimepoint   = timeline_by_timepoint[x.$['end-reference']]

      var currentIntermediateTimepoint = x.$.startTimepoint

      return _(x.$$)
        .groupBy((y:any) => {
            // set the new timepoint to group by, if it’s a timepoint-reference.
            if (y['#name'] == 'time') {
              currentIntermediateTimepoint = timeline_by_timepoint[y.$['timepoint-reference']]
            }
            return `${x.$['speaker-reference']}-${currentIntermediateTimepoint}`
          })
        .mapValues((z:any) => {
          // delete the timepoint-reference so we’re left with only tokens (including pauses)
          if (z[0] && z[0].$ && z[0]['#name'] == 'time') {
            z.shift()
          }
          return z
        }).value()
    })
    // annoying: manually make a single
    // object of the objects (contributions)
    // in the array (sort of flattening it)
    .reduce((m,e,i,l) => {
      _(e).each((x,i) => m[i] = x)
      return m
    }, {})
    .value()
  return cs
}

const getOriginalTimelineByTLI = original => {
  const timeline = _(original['basic-transcription'].$$)
    .filter({ '#name' : 'basic-body' })
    .value()[0]['common-timeline'].$$
  const timeByTimepoint = _(timeline)
    .groupBy(x => {
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

  const tiers = tiers_with_comments.filter(t => t.$.category === 'v')
  return tiers
}

const markFragmentsInTokens = tokens => {
  return _(tokens).map((e,i) => {
    if (true) {

    }
  }).value()
}

// START

const fnames = fs.readdirSync(path.join(__dirname, '/data/original'))
  .filter(x => x !== '.DS_Store')
  .map(v => v.split('.')[0])

_(fnames).each((fname) => {
  var originalXML, orthographicXML
  try{
    originalXML     = fs.readFileSync(__dirname + `/data/original/${fname}.exb`).toString()
    orthographicXML = fs.readFileSync(__dirname + `/data/ortho/${fname}.fln`).toString()
  }catch(e){
    console.log('could not find a file:')
    console.log(e)
    return
  }
  return Promise.all([
    parseXML(originalXML),
    parseXML(orthographicXML)
  ])
  .then(([original, orthographic]) => {

    console.log(`---- PROCESSING ${fname}`)

    var originalTimelineByTLI = getOriginalTimelineByTLI(original)

    var orthoBySpeakerAndStartTime = getContributionsBySpeakerAndStartTime(orthographic)

    var originalTiers = getTiers(original)

    var parseEvent = (e, l, i, fragment_of = null) => {
      // not parsed yet:
      if (!e.tokens) {
        e.event_text = e._ ? clone(e._) : null
        e.tli_start  = e.$.start
        e.tli_end    = e.$.end
        e.tokens     = e.event_text ? tokenizeFragment(e.event_text) : []
        e.tokens     = _(e.tokens).map((t:any, ti:number) => {
          return {
            text           : t,
            startTimepoint : ti == 0 && e.$.start ? originalTimelineByTLI[e.$.start] : null,
            endTimepoint   : ti+1 == e.tokens.length && e.$.end ? originalTimelineByTLI[e.$.end] : null,
            fragment_of    : ti == 0 && fragment_of !== null ? fragment_of : null,
          }
        })
        .value()
        delete e._
        delete e.$
        // console.log(e)
      // already parsed (via lookahead)
      }else{
        return clone(e)
      }

      // the event ends with a whitespace => the last token is not interrupted/split between events
      // => return tokenized event
      if (
        e.event_text && (
          e.event_text.slice(-1) === ' '
          || e.event_text.slice(-1) === ','
          || e.event_text.slice(-1) === ']'
        )
      ){
        return clone(e)

      // it’s interrupted (i.e. the last word is incomplete)
      // => descend into next event, and append its text
      // to the current token text
      }else{
        e.tokens = e.tokens.map((token, ti) => {
          // the last event token
          if (ti+1 == e.tokens.length && l[i+1] !== undefined) {
            var next                     = parseEvent(l[i+1], l, i+1, i)
            l[i+1].skip_first            = true
            if (l[i+1].tokens[0] !== undefined) {
              e.next_token                 = next.tokens[0]
              l[i+1].tokens[0].fragment_of = i
              token.text                   = token.text + next.tokens[0].text
            }else{
              console.log('l[i+1].tokens[0] === undefined', l[i+1])
            }
            // console.log('interrupted:', token.text, 'next:', l[i+1].tokens)
            // console.log('l[i+1].tokens[0].fragment_of',i+1,l[i+1].tokens[0].fragment_of);
            return token
          }else{
            return token
          }
        })
        return clone(e)
      }
    }

    const joinEvents = (events) => {
      return _(events)
        .map((e, i) => parseEvent(e, events, i))
        .filter()
        .value()
    }

    const originalEventTokensBySpeaker = _(originalTiers).map((tier:any) => {
      return {
        speaker : tier.$['display-name'],
        events  : joinEvents(tier.event)
      }
    }).value()

    // log(originalEventTokensBySpeaker)

    const findOrthographicContributionWords = (speakerShorthand:string, startTimepoint:string) => {

      var orthoContribList = orthoBySpeakerAndStartTime[`${speakerShorthand}-${startTimepoint}`]
      var orthoContrib = orthoContribList && orthoContribList.length ? orthoContribList : []
      return orthoContrib || null
    }

    type token = {
      text : any,
      ortho : string | null,
      speaker : string,
      fragment_of : number | null | undefined,
      token_id: number,
      event_id: number,
      startTimepoint: string | null | undefined,
      endTimepoint:string | null | undefined,
      token_type_id: number
    }

    var speakersWithEventsWithTokens = _(originalEventTokensBySpeaker).map((speaker, speakerIndex) => {
      const speakerShorthand = speaker.speaker.split(' ')[0]
      var tokenIndex = 0
      return _(speaker.events).map((event:any, eventIndex) => {
        const eventOrthographicContributionWords = event.tokens[0] ? findOrthographicContributionWords(speakerShorthand, event.tokens[0].startTimepoint) : []
        var nonWordTokenIndex = 0
        return _(event.tokens).map((t:any, eventTokenIndex) => {
          var ortho = t.startTimepoint ? orthoBySpeakerAndStartTime[`${speakerShorthand}-${t.startTimepoint}`] : null
          return {
            token_id        : tokenIndex += 1,
            speaker         : speakerShorthand,
            text            : t.text,
            ortho           : (() => {
              if(t.text !== undefined){
                if (getTokenTypeFromToken(t.text) == TOKEN_TYPES.delimitier.id) {
                  // console.log('non word token', t.text)
                  nonWordTokenIndex++
                }
                if (isWordToken(t)) {
                  const orthoAtIndex = eventOrthographicContributionWords[eventTokenIndex-nonWordTokenIndex]
                  if (orthoAtIndex && orthoAtIndex.$) {
                    // log discrepancies
                    if (orthoAtIndex._ != t.text) {
                      // console.error('disconnect', t.text, orthoAtIndex._, '\neventTokenIndex', eventTokenIndex, 'nonWordTokenIndex', nonWordTokenIndex, 'orthoAtIndex._', tokenIndex +1 , speakerShorthand, eventOrthographicContributionWords.map(x => x._), event.tokens.map(x => x.text))
                      // console.info(fname, 'disconnect', t.text, orthoAtIndex._)
                    }
                    return orthoAtIndex.$.n
                  }else{
                    return null
                  }
                }else{
                  return null
                }
              }else{
                return null
              }
            })(),
            fragment_of      : t.fragment_of !== null ? tokenIndex - 1 : null,
            event_id         : eventIndex,
            start_timepoint  : t.startTimepoint,
            end_timepoint    : t.endTimepoint,
            transcript_name  : fname,
            token_type_id    : getTokenTypeFromToken(t.text)
            // orthographicContributionWords : eventOrthographicContributionWords,
          }
        }).value()
      }).value()
    })
    .value()

    // var [tokens_words_only, tokens_non_words] = clone(_.partition(tokens, isWordToken))
    // log(orthoBySpeakerAndStartTime)
    // log(speakersWithEventsWithTokens)

    dao.writeTokens(_(speakersWithEventsWithTokens).flattenDeep().value())
    .catch(e => console.log(e))

    // fs.writeFileSync(`./data/output/${fname}.csv`, speakersWithEventsWithTokens.map((x) => {
    //   return _(x).toArray().value().join(',')
    // }).join('\n'))
    //
    fs.writeFileSync(`./data/output/${fname}.json`, JSON.stringify(speakersWithEventsWithTokens, null, 4))

    return speakersWithEventsWithTokens

  })
})
