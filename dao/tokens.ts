import * as _      from 'lodash'
import * as format from 'pg-format'
import SQL         from 'sql-template-strings'
import db          from './connection'

interface Itoken {
  text : string,
  ortho : string | null,
  speaker : string,
  fragment_of : number | null | undefined,
  token_id: number,
  event_id: number,
  startTimepoint: string | null | undefined,
  endTimepoint:string | null | undefined,
  token_type_id: number
}

export default {
  async writeTokens(tokens){

    const values = _(tokens).map((t) => _(t).toArray().value()).value()

    const dbresult = await db.query(format(`
      INSERT INTO
      transcript.token(
        token_id,
        speaker,
        text,
        text_in_ortho,
        ortho,
        fragment_of,
        sequence_in_sentence,
        sentence_id,
        event_id,
        transcript_id,
        token_type_id,
        likely_error
      )
      VALUES %L
      ON CONFLICT (token_id, speaker, transcript_id) DO UPDATE
        SET
          text = EXCLUDED.text,
          text_in_ortho = EXCLUDED.text,
          ortho = EXCLUDED.ortho,
          fragment_of = EXCLUDED.fragment_of,
          sequence_in_sentence = EXCLUDED.sequence_in_sentence,
          token_type_id = EXCLUDED.token_type_id,
          likely_error = EXCLUDED.likely_error,
          sentence_id = EXCLUDED.sentence_id;
    `, values))
    .catch((e) => {
      console.log(values[0][8])
      console.log(_(values)
        .groupBy((x) => `${x[8]}-${x[1]}-${x[0]}`)
        .filter((x) => x.length > 1)
        .value()
      )
      console.log(e)
    })
    if (dbresult && dbresult.length) {
      console.log(dbresult)
    }
    return dbresult

  }
}
