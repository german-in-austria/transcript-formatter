import * as pgp from 'pg-promise'
import * as _ from 'lodash'
import * as format from 'pg-format'

const db = pgp()('postgres://postgres:password@localhost:5432/postgres')

type token = {
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

    var values = _(tokens).map(t => _(t).toArray().value()).value()

    const dbresult = await db.query(format(`INSERT INTO
      transcript.token(
        token_id,
        speaker,
        text,
        ortho,
        fragment_of,
        event_id,
        start_timepoint,
        end_timepoint,
        transcript_name,
        token_type_id)
      VALUES %L
      ON CONFLICT (token_id, speaker, transcript_name) DO UPDATE
        SET
          text = EXCLUDED.text,
          ortho = EXCLUDED.ortho,
          fragment_of = EXCLUDED.fragment_of,
          token_type_id = EXCLUDED.token_type_id;
    `, values))
    .catch(e => {
      console.log(values[0][8])
      console.log(_(values)
        .groupBy(x => `${x[8]}-${x[1]}-${x[0]}`)
        .filter(x => x.length > 1)
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
