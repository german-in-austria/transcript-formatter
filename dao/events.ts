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
  async writeEvents(events){

    const values = _(events).map((e) => _(e).toArray().value()).value()

    const dbresult = await db.query(format(`
      INSERT INTO
      transcript.event(
        id,
        start_time,
        end_time
      )
      VALUES %L
    `, values))
    .catch((e) => {
      console.log(e)
    })
    if (dbresult && dbresult.length) {
      console.log(dbresult)
    }
    return dbresult

  }
}
