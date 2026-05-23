# telegram-updates-js
Get updates of telegram channel to your node js daemon.

# Set up .env vars
...

# How to use
npm i dotenv
npm i telegram

# run manually for the first time and input code from your telegram
node tgupdates.js

# run with pm2
pm2 start ecosystem.js

# stop with pm2
pm2 delete ecosystem.js