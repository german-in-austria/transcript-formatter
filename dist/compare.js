"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("lodash");
const xml2js = require("xml2js");
const fs = require("fs");
const tokens_1 = require("./dao/tokens");
// catch unhandled rejections
process.on('unhandledRejection', (err, promise) => {
    console.log(err, promise);
});
const log = (obj, len = 100) => {
    return console.log(require('util').inspect(obj, {
        depth: null,
        maxArrayLength: len
    }));
};
const parser = new xml2js.Parser({
    explicitArray: false,
    preserveChildrenOrder: true,
    mergeAttrs: false,
    explicitChildren: true
});
const parseXML = (string) => {
    return new Promise((resolve, reject) => {
        parser.parseString(string, (err, res) => {
            if (err == null) {
                resolve(res);
            }
            else {
                reject(err);
            }
        });
    });
};
const clone = obj => {
    if (obj !== undefined) {
        return JSON.parse(JSON.stringify(obj));
    }
    else {
        return undefined;
    }
};
const isWordToken = t => {
    return t.text != '.'
        && t.text != ','
        && t.text[0] != ','
        && t.text != '?'
        && t.text[0] != "["
        && t.text[0] != "("
        && !t.fragment_of;
};
const tokenizeFragment = sentence_fragment => {
    // TODO: THIS IS IMPROPPER
    return sentence_fragment
        .split('.').join(' .')
        .split(', ').join(' , ')
        .split('-').join(' ') // tokens from assimilations
        .split('? ').join(' ? ')
        .split(' ')
        .filter(t => t != '');
};
const TOKEN_TYPES = {
    unknown: 1,
    delimitier: 2,
    pause: 3
};
const getTokenTypeFromToken = (text) => {
    if (text == '.'
        || text == ','
        || text == '?'
        || text == '!') {
        return TOKEN_TYPES.delimitier;
    }
    else if (text.match(/\[[\s\S]{1,}s\]/g).length > 0) {
        return TOKEN_TYPES.pause;
    }
    else {
        return TOKEN_TYPES.unknown;
    }
};
const getContributionsBySpeakerAndStartTime = orthographic_transcript => {
    const timeline_by_timepoint = _(orthographic_transcript['folker-transcription'].$$)
        .chain()
        .filter({ '#name': 'timeline' })
        .first()
        .get('$$')
        .groupBy(x => x.$['timepoint-id'])
        .mapValues(x => x[0].$['absolute-time'])
        .value();
    const cs = _(orthographic_transcript['folker-transcription'].$$)
        .chain()
        .filter({ '#name': 'contribution' })
        .map(x => {
        // add absolute time to contribution
        x.$.startTimepoint = timeline_by_timepoint[x.$['start-reference']];
        x.$.endTimepoint = timeline_by_timepoint[x.$['end-reference']];
        var currentIntermediateTimepoint = x.$.startTimepoint;
        return _(x.$$)
            .groupBy((y) => {
            // set the new timepoint to group by, if it’s a timepoint-reference.
            if (y['#name'] == 'time') {
                currentIntermediateTimepoint = timeline_by_timepoint[y.$['timepoint-reference']];
            }
            return `${x.$['speaker-reference']}-${currentIntermediateTimepoint}`;
        })
            .mapValues((z) => {
            // delete the timepoint-reference so we’re left with only tokens (including pauses)
            if (z[0] && z[0].$ && z[0]['#name'] == 'time') {
                z.shift();
            }
            return z;
        }).value();
    })
        .reduce((m, e, i, l) => {
        _(e).each((x, i) => m[i] = x);
        return m;
    }, {})
        .value();
    return cs;
};
const getOriginalTimelineByTLI = original => {
    const timeline = _(original['basic-transcription'].$$)
        .filter({ '#name': 'basic-body' })
        .value()[0]['common-timeline'].$$;
    const timeByTimepoint = _(timeline)
        .groupBy(x => {
        return x.$.id;
    })
        .mapValues(x => x[0].$.time)
        .value();
    return timeByTimepoint;
};
const getTiers = original => {
    const tiers_with_comments = _(original['basic-transcription'].$$)
        .filter({ '#name': 'basic-body' })
        .value()[0].tier;
    const tiers = tiers_with_comments.filter(t => t.$.category != 'c');
    return tiers;
};
// START
const fnames = [
    '01_LE_V2',
    '02_BZ_V2'
];
_(fnames).each((fname) => {
    const originalXML = fs.readFileSync(__dirname + `/data/original/${fname}.exb`).toString();
    const orthographicXML = fs.readFileSync(__dirname + `/data/ortho/${fname}.fln`).toString();
    return Promise.all([
        parseXML(originalXML),
        parseXML(orthographicXML)
    ])
        .then(([original, orthographic]) => {
        var originalTimelineByTLI = getOriginalTimelineByTLI(original);
        var orthoBySpeakerAndStartTime = getContributionsBySpeakerAndStartTime(orthographic);
        var originalTiers = getTiers(original);
        var parseEvent = (e, l, i, fragment_of = null) => {
            // not parsed yet:
            if (!e.tokens) {
                e.event_text = e._ ? clone(e._) : null;
                e.tli_start = e.$.start;
                e.tli_end = e.$.end;
                e.tokens = e.event_text ? tokenizeFragment(e.event_text) : [];
                e.tokens = _(e.tokens).map((t, ti) => {
                    return {
                        text: t,
                        startTimepoint: ti == 0 && e.$.start ? originalTimelineByTLI[e.$.start] : null,
                        endTimepoint: ti + 1 == e.tokens.length && e.$.end ? originalTimelineByTLI[e.$.end] : null,
                        fragment_of: ti == 0 && fragment_of !== null ? fragment_of : null,
                    };
                })
                    .value();
                delete e._;
                delete e.$;
                // console.log(e)
                // already parsed (via lookahead)
            }
            else {
                return clone(e);
            }
            // the event ends with a whitespace => the last token is not interrupted/split between events
            // => return tokenized event
            if (e.event_text && e.event_text.slice(-1) === ' ') {
                return clone(e);
                // it’s interrupted (i.e. the last word is incomplete)
                // => descend into next event, and apend its text
                // to the current token text
            }
            else {
                e.tokens = e.tokens.map((token, ti) => {
                    // the last event token
                    if (ti + 1 == e.tokens.length) {
                        var next = parseEvent(l[i + 1], l, i + 1, i);
                        l[i + 1].skip_first = true;
                        e.next_token = next.tokens[0];
                        l[i + 1].tokens[0].fragment_of = i;
                        token.text = token.text + next.tokens[0].text;
                        // console.log('interrupted:', token.text, 'next:', l[i+1].tokens)
                        // console.log('l[i+1].tokens[0].fragment_of',i+1,l[i+1].tokens[0].fragment_of);
                        return token;
                    }
                    else {
                        return token;
                    }
                });
                return clone(e);
            }
        };
        const joinEvents = (events) => {
            return _(events).map((e, i) => parseEvent(e, events, i)).value();
        };
        const originalEventTokensBySpeaker = _(originalTiers).map((tier) => {
            return {
                speaker: tier.$['display-name'],
                events: joinEvents(tier.event)
            };
        }).value();
        // log(originalEventTokensBySpeaker)
        const findOrthographicContributionWords = (speakerShorthand, startTimepoint) => {
            var orthoContribList = orthoBySpeakerAndStartTime[`${speakerShorthand}-${startTimepoint}`];
            var orthoContrib = orthoContribList && orthoContribList.length ? orthoContribList : [];
            return orthoContrib || null;
        };
        var speakersWithEventsWithTokens = _(originalEventTokensBySpeaker).map((speaker, speakerIndex) => {
            const speakerShorthand = speaker.speaker.split(' ')[0];
            var tokenIndex = 0;
            return _(speaker.events).map((event, eventIndex) => {
                const eventOrthographicContributionWords = event.tokens[0] ? findOrthographicContributionWords(speakerShorthand, event.tokens[0].startTimepoint) : [];
                return _(event.tokens).map((t, eventTokenIndex) => {
                    var ortho = t.startTimepoint ? orthoBySpeakerAndStartTime[`${speakerShorthand}-${t.startTimepoint}`] : null;
                    return {
                        token_id: tokenIndex += 1,
                        speaker: speakerShorthand,
                        text: t.text,
                        ortho: (() => {
                            if (t.text !== undefined && isWordToken(t)) {
                                const orthoAtIndex = eventOrthographicContributionWords[eventTokenIndex];
                                if (orthoAtIndex && orthoAtIndex.$) {
                                    // log discrepancies
                                    if (orthoAtIndex._ != t.text) {
                                        console.error('disconnect', orthoAtIndex._, t.text, tokenIndex + 1, speakerShorthand);
                                    }
                                    return orthoAtIndex.$.n;
                                }
                                else {
                                    return null;
                                }
                            }
                            else {
                                return null;
                            }
                        })(),
                        fragment_of: t.fragment_of && eventTokenIndex == 0 ? tokenIndex : null,
                        event_id: eventIndex,
                        start_timepoint: t.startTimepoint,
                        end_timepoint: t.endTimepoint,
                        transcript_name: fname,
                        token_type_id: getTokenTypeFromToken(t.text)
                        // orthographicContributionWords : eventOrthographicContributionWords,
                    };
                }).value();
            }).value();
        })
            .flattenDeep()
            .value();
        // var [tokens_words_only, tokens_non_words] = clone(_.partition(tokens, isWordToken))
        // log(orthoBySpeakerAndStartTime)
        log(speakersWithEventsWithTokens);
        tokens_1.default.writeTokens(speakersWithEventsWithTokens);
        fs.writeFileSync(`./data/output/${fname}.csv`, speakersWithEventsWithTokens.map((x) => {
            return _(x).toArray().value().join(',');
        }).join('\n'));
        return speakersWithEventsWithTokens;
    });
});
