#!/usr/bin/node

const dash = require('dashdash');

const parser = dash.createParser({options: [
	{
		names: ['help', 'h'],
		type: 'bool',
		help: 'Print this help and exit.'
	},
	{
		names: ['html'],
		type: 'string',
		help: 'modified html file name'
	},
	{
		names: ['prepend', 'p'],
		type: 'arrayOfString',
		help: 'prepend scripts'
	},
	{
		names: ['append', 'a'],
		type: 'arrayOfString',
		help: 'append scripts'
	},
	{
		names: ['exclude', 'x'],
		type: 'arrayOfString',
		help: 'exclude scripts, links, imports'
	},
	{
		names: ['ignore', 'i'],
		type: 'arrayOfString',
		help: 'ignore scripts, links, imports'
	},
	{
		names: ['js'],
		type: 'string',
		help: 'js bundle file name'
	},
	{
		names: ['css'],
		type: 'string',
		help: 'css bundle file name'
	},
	{
		names: ['remotes'],
		type: 'arrayOfString',
		help: 'domains from which styles or scripts can be downloaded'
	},
	{
		names: ['concatenate'],
		type: 'bool',
		help: 'do not minify'
	},
	{
		names: ['minify'],
		type: 'bool',
		help: 'minify, overrides concatenate'
	},
	{
		names: ['root'],
		type: 'string',
		help: 'root directory instead of dirname(html file path)'
	},
	{
		names: ['modulesPrefix'],
		type: 'string',
		help: 'prefix for node_modules, defaults to /'
	},
	{
		names: ['modulesRoot'],
		type: 'string',
		help: 'root for node_modules, defaults to .'
	},
	{
		names: ['assets'],
		type: 'string',
		help: 'relative path where stylesheets assets are copied, defaults to ./assets'
	},
	{
		names: ['analyze'],
		type: 'bool',
		help: 'outputs bundle informations on stderr'
	}
]});

let opts;
try {
	opts = parser.parse(process.argv);
} catch(e) {
	console.error(e.toString());
	opts = {help: true};
}

// eslint-disable-next-line no-underscore-dangle
const htmlInputPath = opts._args && opts._args.pop();

if (opts.help || !htmlInputPath || !require('node:fs').existsSync(htmlInputPath)) {
	const help = parser.help({includeEnv: true}).trimRight();
	console.info(`usage: webmodule-bundle [opts] <html file path>\n${help}`);
	process.exit(0);
}

const bundle = require('..');

opts.cli = true;

bundle(htmlInputPath, opts).then((data) => {
	if (!opts.js) console.info(data.js);
}).catch((err) => {
	console.error(err);
	process.exit(1);
});
