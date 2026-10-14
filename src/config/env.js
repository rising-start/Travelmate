require('dotenv').config();

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  MAP_API_KEY: process.env.MAP_API_KEY,
  WEATHER_API_KEY: process.env.WEATHER_API_KEY,
  LLM_API_KEY: process.env.LLM_API_KEY,
  SILICON_FLOW_API_KEY: process.env.SILICON_FLOW_API_KEY,
  PORT: process.env.PORT || 3001,
  DEBUG: process.env.DEBUG === 'true',
};
