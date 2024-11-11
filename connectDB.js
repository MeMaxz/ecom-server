const { Pool } = require("pg");

const user = "postgres";
const host = "localhost";
const database = "e_com";
const password = "1234";
const port = 5432;

const pool = new Pool({
  user,
  host,
  database,
  password,
  port,
});

module.exports = pool;
