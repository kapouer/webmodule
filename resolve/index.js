const { readFile } = require('node:fs/promises');
const upath = require('upath');
const PKGKEY = "@webmodule/resolve";

module.exports = class Resolver {
	constructor({ prefix = "/", root = ".", modules = {} }) {
		this.modules = modules;
		this.parent = root;
		this.root = upath.resolve(root, "node_modules");
		this.prefix = prefix + "node_modules/";
	}
	async resolve(url, type) {
		const { modules, prefix, root } = this;
		const ret = {};
		if (!url.startsWith(prefix)) return ret;
		url = url.substring(prefix.length);
		const [moduleName, relUrl] = urlParts(url);
		if (!moduleName) return ret;
		if (!modules["."]) {
			modules["."] = await pkgExports(this.parent, modules);
		}
		let mod = modules[moduleName];
		const dir = upath.join(root, moduleName);
		if (!mod) {
			mod = modules[moduleName] = await pkgExports(dir, modules);
		}
		const paths = mod[type];
		if (!paths) return ret;
		const relKey = relUrl ? "./" + relUrl : ".";
		let relPath = paths[relKey] || relKey;
		if (relPath === ".") relPath = "./index"; // last chance
		if (!upath.extname(relPath)) {
			relPath += `.${type}`;
		}

		const newUrl = upath.join(moduleName, relPath);
		ret.path = upath.join(dir, relPath);
		if (url !== newUrl) ret.url = this.prefix + newUrl;
		return ret;
	}
};

function urlParts(url) {
	const list = url.split('/');
	if (!list.length) return [null, null];
	let name = list.shift();
	if (name.charAt(0) === "@") name += "/" + list.shift();
	return [name, list.join('/')];
}

async function getPkg(path) {
	try {
		return JSON.parse(await readFile(path));
	} catch (err) {
		console.error(err);
		return null;
	}
}

function importConf(obj) {
	let conf = {};
	if (typeof obj == "string") conf.js = { ".": obj };
	else if (obj.js || obj.css) conf = obj;
	else conf.js = obj;
	return conf;
}

async function pkgExports(dir, modules) {
	const pkg = await getPkg(upath.join(dir, 'package.json'));
	if (!pkg) return {};
	for (const [mod, conf] of Object.entries(pkg[PKGKEY] || {})) {
		if (!modules[mod]) {
			modules[mod] = importConf(conf);
		}
	}

	const paths = { css: {}, js: {} };
	if (pkg.style) paths.css["."] = pkg.style;
	if (pkg.exports) {
		for (const key in pkg.exports) {
			const exp = pkg.exports[key];
			if (key === "import") {
				paths.js['.'] = exp;
			} else if (key.startsWith(".")) {
				if (typeof exp == "object" && exp.import) {
					paths.js[key] = exp.import;
				} else {
					paths.js[key] = exp;
				}
			}
		}
	} else {
		paths.js["."] = pkg.module || pkg['jsnext:main'] || pkg.main || null;
		if (!pkg.style) paths.css["."] = pkg.module || pkg.main || null;
	}
	return paths;
}
