import * as _      from 'lodash'
import * as format from 'pg-format'
import db          from './connection'

async function writeTranscript(transcript_name:string[]){
  const q = format(`
    INSERT INTO
      transcript.transcript(name)
    VALUES %L
    ON CONFLICT (name) DO UPDATE
      SET
        name = EXCLUDED.name
    RETURNING id
  `, [transcript_name])
  return await db.query(q)
  .then(([{ id }]) => id)
  .catch((e) => {
    console.log(e)
  })
}

export default {
  writeTranscript
}
