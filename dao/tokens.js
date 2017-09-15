
const knex = require('knex')({
  client: 'mysql2',
  connection: {
    host : 'localhost',
    user : 'root',
    password : 'test',
    database : 'dioe'
  }
})


var create = () => {
  return knex.schema.createTableIfNotExists('tokens', (table) => {
    table.increments()
    table.string('text')
    table.integer('fragment_of')
    table.integer('token_id')
    table.integer('event_id')
    table.string('start')
    table.string('end')
    table.string('normalized')
    table.boolean('is_assimilated')
    table.boolean('original_changed')
    table.string('ortho_by_index')
    table.boolean('ortho_by_index_changed')
    table.timestamps(false, true)
  })
}

module.exports.insertTokens = (tokens) => {
  return create().then(() => {
    return knex('tokens').insert(tokens)
  })
  // .toSQL())
  .then((yo) => console.log('yo', yo))
}
