#!/usr/bin/node

const glob = require('glob');
const Path = require('node:path');

const bundle = require('..');

const dash = require('dashdash');

const parser = dash.createParser({options: [
	{
		names: ['help', 'h'],
		type: 'bool',
		help: 'Print this help and exit.'
	},
	{
		names: ['common'],
		type: 'string',
		help: 'html file with common resources'
	},
	{
		names: ['ignore'],
		type: 'arrayOfString',
		help: 'files to ignore from glob'
	},
	{
		names: ['filter'],
		type: 'arrayOfString',
		help: 'nodes having a src of href matching this regexp will be left untouched'
	},
	{
		names: ['public'],
		type: 'string',
		help: 'root public dir',
		default: 'public'
	},
	{
		names: ['bundles'],
		type: 'string',
		help: 'bundle dir relative to root dir',
		default: 'bundles'
	},
	{
		names: ['remotes'],
		type: 'arrayOfString',
		help: 'domains from which styles or scripts can be downloaded'
	},
	{
		names: ['concatenate', 'c'],
		type: 'bool',
		help: 'do not minify'
	},
	{
		names: ['custom'],
		type: 'string',
		help: 'custom module for dom modifications'
	}
]});

let opts;
try {
	opts = parser.parse(process.argv);
} catch(e) {
	console.error(e.toString());
	opts = {help: true};
}

const customPlugin = opts.custom && require(opts.custom);

// eslint-disable-next-line no-underscore-dangle
const globPattern = opts._args && opts._args.pop();

if (opts.help || !globPattern) {
	const help = parser.help({includeEnv: true}).trimRight();
	console.warn(`usage: bundle --ignore myfile-*.html --common common.html **/*.html\n${help}`);
	process.exit(0);
}

let exclude = [];
const prepend = [];
const ignore = opts.filter || [];

let p = Promise.resolve();

if (opts.common) {
	const commonBase = Path.join(
		Path.dirname(opts.common),
		Path.basename(opts.common, Path.extname(opts.common))
	);
	const commonOpts = {
		remotes: opts.remotes,
		js: `${opts.bundles}/${commonBase}.js`,
		css: `${opts.bundles}/${commonBase}.css`,
		root: opts.public,
		concatenate: opts.concatenate,
		cli: true
	};
	prepend.push(commonOpts.css, commonOpts.js);
	ignore.push(commonOpts.css, commonOpts.js);
	p = p.then(() => {
		return bundle(Path.join(opts.public, opts.common), commonOpts).then((data) => {
			exclude = exclude
				.concat(data.scripts)
				.concat(data.stylesheets)
				.concat(data.imports);
		});
	});
}

p.then(() => {
	return new Promise((resolve, reject) => {
		const globIgnores = opts.ignore || [];
		globIgnores.push(Path.join(opts.bundles, '**'));
		if (opts.common) globIgnores.push(opts.common);
		glob(Path.join(opts.public, globPattern), {
			ignore: globIgnores.map((ign) => {
				return Path.join(opts.public, ign);
			})
		}, (err, files) => {
			if (err) reject(err);
			else resolve(files);
		});
	});
}).then((files) => {
	return Promise.all(files.filter((file) => {
		console.info(file);
		// useful for debugging
		// return file == "public/index.html" || file == "public/header.html";
		return true;
	}).map((file) => {
		const dir = Path.join(opts.bundles, Path.relative(opts.public, Path.dirname(file)));
		const base = Path.basename(file, '.html');
		const bdOpts = {
			remotes: opts.remotes,
			custom: customPlugin,
			concatenate: opts.concatenate,
			exclude: exclude,
			prepend: prepend,
			ignore: ignore,
			js: Path.join(dir, base + '.js'),
			css: Path.join(dir, base + '.css'),
			html: Path.join(dir, base + '.html'),
			cli: true
		};
		if (dir !== opts.bundles) bdOpts.root = opts.public;
		return bundle(file, bdOpts);
	}));
}).then((all) => {
	console.info(`Processed ${all.length} files`);
}).catch((err) => {
	console.error(err);
});
