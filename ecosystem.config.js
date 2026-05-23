module.exports = {
    apps: [{
        name: 'telegram-updates',
        namespace: 'as',
        cwd: '.',
        script: './tgupdates.js',
        error_file: './logs/server.error.log',
        out_file: './logs/server.log',
        time: true,
    }],
};
