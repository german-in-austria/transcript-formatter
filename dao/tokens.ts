import * as pgp from 'pg-promise'
import * as _ from 'lodash'
import * as format from 'pg-format'

const db = pgp()('postgres://postgres:password@localhost:5432/postgres')

// type token = {
//   text : string,
//   ortho : string | null,
//   speaker : string,
//   fragment_of : number,
//   token_id: number,
//   event_id: number,
//   startTimepoint: string,
//   endTimepoint:string
// }

export default {
  async writeTokens(tokens){

    var values = _(tokens).map(t => _(t).toArray().value()).value()

    await db.query(format(`INSERT INTO
      transcript.tokens(
        token_id,
        speaker,
        text,
        ortho,
        fragment_of,
        event_id,
        start_timepoint,
        end_timepoint)
      VALUES %L`, values))
  }
}
