process.title = 'tf'

declare var __dirname
declare var process

import * as promise     from 'bluebird'
import * as levenshtein from 'fast-levenshtein'
import * as fs          from 'fs'
import * as _           from 'lodash'
import * as path        from 'path'
import * as util        from 'util'
import * as xml2js      from 'xml2js'
import eventDao         from './dao/events'
import tokenDao         from './dao/tokens'
import transcriptDao    from './dao/transcript'

// catch unhandled rejections
process.on('unhandledRejection', (err, promise1) => {
  console.log(err, promise1)
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
    .split(' )').join(')')
    // .split('nimmer').join('nim_ _mer')
}

const parser = new xml2js.Parser({
  explicitArray         : false,
  preserveChildrenOrder : true,
  mergeAttrs            : false,
  explicitChildren      : true
})

const parseXML = (string) => {
  const fixed = sanitizeXMLString(string)
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

const clone = (obj) => {
  if (obj !== undefined) {
    return JSON.parse(JSON.stringify(obj))
  }else{
    return undefined
  }
}

const isWordToken = (t) => {
  return t.text  !== '.'
    && t.text    !== ','
    && t.text[0] !== ','
    && t.text    !== '?'
    && t.text[0] !== "["
    && t.text[0] !== "("
    && !t.fragment_of
}

const tokenizeFragment = (sentence_fragment) => {
  return sentence_fragment
    .split('.').join(' .')
    .split(', ').join(' , ')
    // tokens from assimilations
    .split('-').join('_ _')
    .split('? ').join(' ? ')
    // corrects mistakes where transcribers didn’t
    // put a space after the comma *within* an event.
    .split(/(?=\D\b)(,)(?=\b\D)/).filter((x) => x !== ',').join(', ')
    // corrects mistakes where transcribers didn’t
    // put a space after the comma *at the end* of an event.
    .split(/,$/).join(', ')
    .split(' ')
    .filter((t) => t !== '')
}

const TOKEN_TYPES = {
  unknown : {
    id : 1
  },
  delimitier : {
    regex : /(\?|\.|\!|\,)(?!\)|\})/,
    id : 2
  },
  pause : {
    id : 3,
    regex : /\[[\s\S]{1,}s\]/g
  },
  proper_name : {
    id : 4,
    regex : /\{[^\?]{1,}\}/
  },
  non_verbal : {
    id : 5,
    regex : /\[[^\d|\?]{1,}\]/
  },
  interrupted : {
    id : 6,
    regex : /([\w]{1,}\/)/
  },
  incomprehensible : {
    id : 7,
    regex : /(\(\?\))/
  },
  contraction : {
    id : 8,
    regex: /(_\S{1,})|(\S{1,}_)/
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
  } else if(text.match(TOKEN_TYPES.interrupted.regex) !== null){
    return TOKEN_TYPES.interrupted.id
  } else if(text.match(TOKEN_TYPES.incomprehensible.regex) !== null){
    return TOKEN_TYPES.incomprehensible.id
  } else if(text.match(TOKEN_TYPES.contraction.regex) !== null) {
    return TOKEN_TYPES.contraction.id
  }else{
    return TOKEN_TYPES.unknown.id
  }
}

const getContributionsBySpeakerAndStartTime = (orthographic_transcript) => {

  const timeline_by_timepoint = _(orthographic_transcript['folker-transcription'].$$)
    .chain()
    .filter({'#name' : 'timeline'})
    .first()
    .get('$$')
    .groupBy((x) => x.$['timepoint-id'])
    .mapValues((x) => x[0].$['absolute-time'])
    .value()

  const cs = _(orthographic_transcript['folker-transcription'].$$)
    .chain()
    .filter({'#name' : 'contribution'})
    .map((x) => {
      // add absolute time to contribution
      x.$.startTimepoint = timeline_by_timepoint[x.$['start-reference']]
      x.$.endTimepoint   = timeline_by_timepoint[x.$['end-reference']]

      var currentIntermediateTimepoint = x.$.startTimepoint

      return _(x.$$)
        .groupBy((y:any) => {
            // set the new timepoint to group by, if it’s a timepoint-reference.
            if (y['#name'] === 'time') {
              currentIntermediateTimepoint = timeline_by_timepoint[y.$['timepoint-reference']]
            }
            return `${x.$['speaker-reference']}-${currentIntermediateTimepoint}`
          })
        .mapValues((z:any) => {
          // delete the timepoint-reference so we’re left with only tokens (including pauses)
          if (z[0] && z[0].$ && z[0]['#name'] === 'time') {
            z.shift()
          }
          return z
        }).value()
    })
    // annoying: manually make a single
    // object of the objects (contributions)
    // in the array (sort of flattening it)
    .reduce((m,e,i,l) => {
      _(e).each((x, index) => m[index] = x)
      return m
    }, {})
    .value()
  return cs
}

const getOriginalTimelineByTLI = (original) => {
  const timeline = _(original['basic-transcription'].$$)
    .filter({ '#name' : 'basic-body' })
    .value()[0]['common-timeline'].$$
  const timeByTimepoint = _(timeline)
    .groupBy((x) => {
      return x.$.id
    })
    .mapValues((x) => x[0].$.time)
    .value()
  return timeByTimepoint
}

const getTiers = (original) => {
  const tiers_with_comments = _(original['basic-transcription'].$$)
    .filter({ '#name' : 'basic-body' })
    .value()[0].tier

  const tiers = tiers_with_comments.filter((t) => t.$.category === 'v')
  return tiers
}

// START
var event_id = 0
var sentence_id = 0

const fnames = fs.readdirSync(path.join(__dirname, '/data/original'))
  .filter((x) => x !== '.DS_Store')
  .map((v) => v.split('.')[0])

promise.mapSeries(fnames, async (fname) => {
  var originalXML
  var orthographicXML
  try{
    originalXML     = fs.readFileSync(__dirname + `/data/original/${fname}.exb`).toString()
    orthographicXML = fs.readFileSync(__dirname + `/data/ortho/${fname}.fln`).toString()
  }catch(e){
    console.log('could not find a file:')
    console.log(e)
    return
  }
  const transcript_id = await transcriptDao.writeTranscript([fname])
  return await Promise.all([
    parseXML(originalXML),
    parseXML(orthographicXML)
  ])
  .then(([original, orthographic]) => {
    console.log(fname)
    console.log(`---- PROCESSING ${fname}`)

    const originalTimelineByTLI = getOriginalTimelineByTLI(original)

    const orthoBySpeakerAndStartTime = getContributionsBySpeakerAndStartTime(orthographic)

    const originalTiers = getTiers(original)

    const parseEvent = (e, l, i, fragment_of = null) => {
      // not parsed yet:
      if (!e.tokens) {
        e.event_text = e._ ? clone(e._) : null
        e.tli_start  = e.$.start
        e.tli_end    = e.$.end
        e.tokens     = e.event_text ? tokenizeFragment(e.event_text) : []
        e.tokens     = _(e.tokens).map((t:any, ti:number) => {
          return {
            text           : t,
            startTimepoint : ti === 0 && e.$.start ? originalTimelineByTLI[e.$.start] : null,
            endTimepoint   : ti+1 === e.tokens.length && e.$.end ? originalTimelineByTLI[e.$.end] : null,
            fragment_of    : ti === 0 && fragment_of !== null ? fragment_of : null,
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
          if (ti+1 === e.tokens.length && l[i+1] !== undefined) {
            const next        = parseEvent(l[i+1], l, i+1, i)
            l[i+1].skip_first = true
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

    const joinEvents = (es) => {
      return _(es)
        .map((e, i) => parseEvent(e, es, i))
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

    const continueCommentsAndNames = (tokens) => {
      var continuedCommentId = null
      var continuedNameId = null
      return _(tokens).map((token: any) => {

        // COMMENTS
        // beginning of a continued comment
        if (token.text.trim().slice(0,1) === '[' && token.text.trim().slice(-1) !== ']' ){
          token.token_type_id = TOKEN_TYPES.non_verbal.id
          continuedCommentId = token.token_id
        // in-between-ers and end of a continued item
        }else if (continuedCommentId !== null) {
          token.token_type_id = TOKEN_TYPES.non_verbal.id
          token.fragment_of = continuedCommentId
        }
        // end of a continued comment
        if (token.text.trim().slice(0, 1) !== '[' && token.text.trim().slice(-1) === ']' ){
          continuedCommentId = null
        }

        // NAMES
        // beginning of a continued name
        if (token.text.trim().slice(0,1) === '{' && token.text.trim().slice(-1) !== '}' ){
          token.token_type_id = TOKEN_TYPES.proper_name.id
          continuedNameId = token.token_id
        // in-between-ers and end of a continued item
        }else if (continuedNameId !== null) {
          token.token_type_id = TOKEN_TYPES.proper_name.id
          token.fragment_of = continuedNameId
        }
        // end of a continued comment
        if (token.text.trim().slice(0, 1) !== '{' && token.text.trim().slice(-1) === '}' ){
          continuedNameId = null
        }
        return token
      })
    }

    const findOrthographicContributionWords = (speakerShorthand:string, startTimepoint:string) => {

      const orthoContribList = orthoBySpeakerAndStartTime[`${speakerShorthand}-${startTimepoint}`]
      const orthoContrib = orthoContribList && orthoContribList.length ? orthoContribList : []
      return orthoContrib || null
    }

    const transcriptEvents = {
      events: [],
      add(event){
        this.events.push(event)
      }
    }

    const speakersWithEventsWithTokens = _(originalEventTokensBySpeaker).map((speaker, speakerIndex) => {
      const speakerShorthand = speaker.speaker.split(' ')[0]
      var tokenIndex = 0
      var sequence_in_sentence = 0
      return _(speaker.events).map((event:any, eventIndex) => {
        event_id = event_id + 1
        transcriptEvents.add({
          id: event_id,
          start_time: event.tokens && event.tokens[0]
            ? event.tokens[0].startTimepoint
            : undefined,
          end_time: event.tokens && event.tokens[0]
            ? event.tokens[(event.tokens.length || 1)-1].endTimepoint
            : undefined
        })
        const eventOrthographicContributionWords = event.tokens[0]
          ? findOrthographicContributionWords(speakerShorthand, event.tokens[0].startTimepoint)
          : []
        var nonWordTokenIndex = 0
        return _(event.tokens).map((t:any, eventTokenIndex) => {
          var is_likely_error = false
          const ortho = t.startTimepoint ? orthoBySpeakerAndStartTime[`${speakerShorthand}-${t.startTimepoint}`] : null
          const orthoAtIndex = eventOrthographicContributionWords[eventTokenIndex-nonWordTokenIndex]
          const tokenType = getTokenTypeFromToken(t.text)
          return {
            token_id        : tokenIndex += 1,
            speaker         : speakerShorthand,
            text            : t.text.trim(),
            text_in_ortho   : (() => {
              if (orthoAtIndex && orthoAtIndex._ && t.text !== undefined && isWordToken(t)) {
                return orthoAtIndex._.trim()
              }else if(t.text !== undefined){
                return t.text.trim()
              }
            })()
            ,
            ortho           : (() => {
              if(t.text !== undefined){
                if (tokenType === TOKEN_TYPES.delimitier.id) {
                  // console.log('non word token', t.text)
                  nonWordTokenIndex++
                }
                if (isWordToken(t)) {
                  if (orthoAtIndex && orthoAtIndex._ && t.text && orthoAtIndex.$ && orthoAtIndex.$.n !== null) {
                    // log discrepancies
                    if (
                      orthoAtIndex._.toLowerCase() !== t.text.toLowerCase() &&
                      tokenType !== TOKEN_TYPES.proper_name.id &&
                      ( t.text[0] !== '_' && t.text.slice(-1) !== '/' )) {
                      if (orthoAtIndex._ && t.text && levenshtein.get(orthoAtIndex._, t.text) > 1) {
                        // side effect.
                        is_likely_error = true
                        console.info(fname, 'disconnect', t.text, orthoAtIndex._)
                      }
                      // console.error('disconnect', t.text, orthoAtIndex._,
                      //   '\neventTokenIndex', eventTokenIndex,
                      //   'nonWordTokenIndex', nonWordTokenIndex,
                      //   'orthoAtIndex._', tokenIndex +1 ,
                      //   speakerShorthand,
                      //   eventOrthographicContributionWords.map(x => x._),
                      //   event.tokens.map(x => x.text))
                    }
                    return orthoAtIndex.$.n ? orthoAtIndex.$.n.trim() : undefined
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
            fragment_of          : t.fragment_of !== null ? tokenIndex - 1 : null,
            sequence_in_sentence : (() => {
              sequence_in_sentence = sequence_in_sentence + 1
              return sequence_in_sentence - 1
            })(),
            sentence_id          : (() => {
              if (t.text === '.' || t.text === '!' || t.text === '?' || t.text === ',') {
                sentence_id = sentence_id + 1 // increment scentence_id
                sequence_in_sentence = 0
                return sentence_id - 1
              }else{
                return sentence_id
              }
            })(),
            event_id         : event_id, // eventIndex,
            transcript_id    : transcript_id,
            token_type_id    : getTokenTypeFromToken(t.text),
            likely_error     : is_likely_error
            // orthographicContributionWords : eventOrthographicContributionWords,
          }
        }).value()
      }).value()
    })
    .value()

    const speakersWithEventsWithTokensContinuedCommentsAndNames = continueCommentsAndNames(
      _(speakersWithEventsWithTokens).flattenDeep().value()
    )

    // writing things is async, i.e. we don’t wait for it.
    eventDao.writeEvents(transcriptEvents.events)
    .then(() => {
      tokenDao.writeTokens(speakersWithEventsWithTokensContinuedCommentsAndNames)
      console.log('events written')
    })
    .catch((e) => console.log(e))
    .then((x) => console.log('tokens written'))

  })
})
