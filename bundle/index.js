const debug = require('debug')('@webmodule/bundle');

const Resolver = require('@webmodule/resolve');

const JSDOM = require('jsdom').JSDOM;

const fs = require('node:fs/promises');

const Path = require('node:path');

const bundler = require('postinstall-esbuild');

module.exports = bundle;

async function bundle(path, opts) {
	opts = Object.assign({
		remotes: [],
		prepend: [],
		append: [],
		exclude: [],
		ignore: []
	}, opts);

	let minify = true;
	if (opts.concatenate !== undefined) minify = !opts.concatenate;
	if (opts.minify !== undefined) minify = opts.minify;
	opts.minify = minify;
	if (!opts.root) opts.root = Path.dirname(path);

	const dom = await loadDom(path, opts.root);
	opts.basepath = dom.basepath;
	const data = {};
	const doc = dom.window.document;
	await processDocument(doc, opts, data);
	if (!opts.css) {
		if (data.css) data.js += '\n(' + function () {
			const sheet = document.createElement('style');
			sheet.type = 'text/css';
			// eslint-disable-next-line no-undef
			sheet.textContent = CSS;
			document.head.appendChild(sheet);
		}.toString().replace('CSS', () => JSON.stringify(data.css)) + ')();';
	} else {
		const cssPath = getRelativePath(opts.basepath, opts.css);
		await writeFile(cssPath, data.css);
		// eslint-disable-next-line no-console
		if (opts.cli) console.warn(opts.css);
		// if (data.cssmap) {
		// 	const cssMapPath = cssPath + '.map';
		// 	await writeFile(cssMapPath, data.cssmap);
		// 	// eslint-disable-next-line no-console
		// 	if (opts.cli) console.warn(opts.css + ".map");
		// }
	}
	const html = dom.serialize();
	if (opts.html) {
		const htmlPath = getRelativePath(opts.basepath, opts.html);
		await writeFile(htmlPath, html);
		// eslint-disable-next-line no-console
		if (opts.cli) console.warn(opts.html);
	} else {
		data.html = html;
	}
	if (opts.js) {
		const jsPath = getRelativePath(opts.basepath, opts.js);
		await writeFile(jsPath, data.js);
		// eslint-disable-next-line no-console
		if (opts.cli) console.warn(opts.js);
		// if (data.jsmap) {
		// 	const jsMapPath = jsPath + '.map';
		// 	await writeFile(jsMapPath, data.jsmap);
		// 	// eslint-disable-next-line no-console
		// 	if (opts.cli) console.warn(opts.js + ".map");
		// }
	}
	return data;
}

async function processDocument(doc, opts, data) {
	Object.assign(data, {
		imports: [],
		scripts: [],
		stylesheets: [],
		assets: [],
		// jsmap: "",
		// cssmap: ""
	});
	if (!data.js) data.js = "";
	if (!data.css) data.css = "";
	await processCustom(doc, opts, data);


	let obj = await processScripts(doc, opts, data);
	if (obj.str) data.js += obj.str;
	// if (obj.map) data.jsmap += obj.map;


	obj = await processStylesheets(doc, opts, data);
	if (obj.css) data.css += obj.css;
	// if (obj.map) data.cssmap += obj.map;
	return data;
}

async function processCustom(doc, opts, data) {
	if (opts.custom) return opts.custom(doc, opts, data);
}

async function processScripts(doc, opts, data) {
	const docRoot = getRelativePath(opts.basepath);
	if (opts.js) {
		opts.append.unshift(opts.js);
		opts.ignore.unshift(opts.js);
	}
	const allScripts = Array.from(doc.querySelectorAll('script')).filter((node) => {
		const src = node.getAttribute('src');
		if (src && filterRemotes(src, opts.remotes) == 0) return false;
		return !node.type || node.type == "text/javascript" || node.type == "module";
	});
	prependToPivot(allScripts, opts.prepend, 'script', 'src', 'js');
	const pivot = appendToPivot(allScripts, opts.append, 'script', 'src', 'js');

	const modulesResolver = resolverPlugin(opts, "resolveId", "js");
	let defer = false;

	allScripts.sort((a, b) => {
		const am = a.type == "module";
		const bm = b.type == "module";
		const ar = a.defer;
		const br = b.defer;
		if (am || bm || ar || br) defer = true;
		if (am && bm) return 0;
		if (!am && bm) return -1;
		if (am && !bm) return 1;
		if (!am && !bm) {
			if (ar && br || !ar && !br) return 0;
			if (!ar && br) return -1;
			if (ar && !br) return 1;
		}
	});
	if (opts.js && defer) pivot.nextElementSibling.setAttribute('defer', '');
	const sources = [];
	allScripts.forEach((node) => {
		const src = node.getAttribute('src');
		let dst = src;
		const esm = node.getAttribute('type') == "module";

		if (src) {
			if (src.startsWith('//')) {
				dst = "https:" + src;
			}
			if (filterByName(dst, opts.ignore)) {
				return;
			}
			if (filterByName(dst, opts.exclude)) {
				removeNodeAndSpaceBefore(node);
				return;
			}
			if (/^https?:\/\//.test(dst) == false) {
				dst = src.startsWith('/')
					? Path.join(opts.root, src)
					: Path.join(docRoot, src);
				if (modulesResolver) {
					sources.push((async () => {
						const level = Path.relative(docRoot, opts.root);
						dst = await modulesResolver.resolveId(
							Path.join(level, src), docRoot
						) || dst;
						if (esm) {
							return { src, dst };
						} else {
							return {
								src,
								dst,
								blob: wrapWindow(await readFile(dst))
							};
						}
					})());
				} else if (esm) {
					sources.push({ src, dst });
				} else {
					sources.push((async () => {
						return {
							src,
							dst,
							blob: wrapWindow(await readFile(dst))
						};
					})());
				}
			}
		} else if (node.textContent) {
			if (opts.ignore.indexOf('.') >= 0) {
				return;
			}
			if (opts.exclude.indexOf('.') >= 0) {
				removeNodeAndSpaceBefore(node);
				return;
			}
			if (esm) {
				sources.push({
					blob: node.textContent
				});
			} else {
				sources.push({
					blob: wrapWindow(node.textContent)
				});
			}
		} else {
			return;
		}
		removeNodeAndSpaceBefore(node);
	});
	const entries = await Promise.all(sources);
	if (entries.length == 0) return {};
	const virtuals = {};
	const bundleStr = entries.map((entry, i) => {
		const { src, dst, blob } = entry;
		if (src) data.scripts.push(src);
		let idst = dst;
		if (blob) {
			idst = `__script${i}__.js`;
			virtuals[idst] = blob;
		}
		if (!idst) {
			throw new Error(`Entry ${i} without dst : ${src}`);
		} else {
			return `import "${Path.toUnix(idst)}";`;
		}
	}).join('\n');
	const bundleName = '__entry__.js';
	virtuals[bundleName] = bundleStr;

	const plugins = [
		rollupVirtual(virtuals),
		modulesResolver,
		rollupResolve.nodeResolve({ browser: true }),
		rollupCommonjs({
			ignoreTryCatch: false
		}),
		rollupBabel.babel(opts.babel),
		opts.minify ? rollupTerser.terser({
			numWorkers: MaxWorkers
		}) : null
	];
	if (opts.analyze) plugins.unshift(rollupAnalyze());

	const result = await rollup.rollup({
		input: bundleName,
		context: 'window',
		plugins
	});
	for (let i = 1; i < result.watchFiles.length; i++) {
		let item = result.watchFiles[i];
		if (item.startsWith('\0')) continue;
		item = Path.toUnix(item);
		if (coreJsRe.test(item) || item.endsWith("/node_modules/regenerator-runtime/runtime.js")) continue;
		const rel = Path.relative(docRoot, item);
		if (!data.scripts.includes(rel)) data.scripts.push(rel);
	}
	const { output } = await result.generate({
		inlineDynamicImports: true,
		format: 'iife'
	});
	const codeList = [];
	// const mapList = [];
	output.forEach((chunk) => {
		if (chunk.code) codeList.push(chunk.code);
		// if (chunk.map) mapList.push(chunk.map);
	});
	return {
		str: codeList.join('\n'),
		// map: mapList.join('\n')
	};
}

async function processStylesheets(doc, opts, data) {
	let path = opts.basepath;
	const pathExt = Path.extname(path);
	const docRoot = Path.dirname(path);
	path = Path.join(docRoot, Path.basename(path, pathExt));
	if (opts.css) {
		opts.append.unshift(opts.css);
		opts.ignore.unshift(opts.css);
	}

	const allLinks = Array.from(doc.querySelectorAll('link[href][rel="stylesheet"],style')).filter((node) => {
		const src = node.getAttribute('href');
		if (src && filterRemotes(src, opts.remotes) == 0) return false;
		return true;
	});

	prependToPivot(allLinks, opts.prepend, 'link', 'href', 'css', { rel: "stylesheet" });
	appendToPivot(allLinks, opts.append, 'link', 'href', 'css', { rel: "stylesheet" });

	const sheets = await Promise.all(allLinks.map(async (node) => {
		const src = node.getAttribute('href');
		let dst = src;
		if (src) {
			if (src.startsWith('//')) dst = "https:" + src;
			if (filterByName(src, opts.ignore)) {
				return "";
			}
			removeNodeAndSpaceBefore(node);
			if (filterByName(src, opts.exclude)) {
				return "";
			}
			if (/^https?:\/\//.test(dst) == false) {
				data.stylesheets.push(src);
				if (src.startsWith('/')) {
					dst = Path.relative(docRoot, Path.join(opts.root, src));
				} else if (!src.startsWith('.')) {
					dst = "./" + src;
				}
				return `@import url("${dst}");`;
			} else if (filterRemotes(dst, opts.remotes) == 1) {
				data.stylesheets.push(src);
				const response = await got(dst);
				return response.body.toString();
			}
		} else if (node.textContent) {
			if (opts.ignore.indexOf('.') >= 0) {
				return "";
			}
			removeNodeAndSpaceBefore(node);
			if (opts.exclude.indexOf('.') >= 0) {
				return "";
			}
			return node.textContent;
		}
	}));

	const blob = sheets.filter((str) => Boolean(str)).join("\n");
	if (!blob) return {};
	const autoprefixerOpts = {};
	const urlOpts = [{
		url(asset) {
			if (asset.pathname) {
				const relPath = Path.toUnix(asset.relativePath);
				if (!data.assets.includes(relPath)) data.assets.push(relPath);
				return relPath;
			}
		},
		multi: true
	}];

	if (opts.assets) {
		const fixRelative = Path.relative(Path.dirname(opts.css || "."), ".");
		urlOpts.push({
			url: "copy",
			useHash: true,
			assetsPath: opts.assets
		}, {
			url(asset) {
				if (asset.url) return Path.join(fixRelative, asset.url);
			},
			multi: true
		});
	}

	const plugins = [
		postcssImport(Object.assign({
			plugins: [postcssUrl({
				url: (asset) => {
					if (asset.pathname) {
						return Path.toUnix(asset.relativePath);
					}
				}
			})],
		}, resolverPlugin(opts, "resolve", "css"))),
		postcssUrl(urlOpts),
		postcssFlexBugs,
		autoprefixer(autoprefixerOpts)
	];
	if (opts.minify) {
		plugins.push(csso({
			comments: false
		}));
	}
	plugins.push(reporter);
	return postcss(plugins).process(blob, {
		from: path,
		to: path + '.css',
		map: false,
		// {
		// 	inline: false
		// }
	});
}


function getRelativePath(basepath, path) {
	const dir = Path.dirname(basepath);
	if (path) return Path.join(dir, path);
	else return dir;
}

function wrapWindow(str) {
	return `(function() {
		${str}
	}).call(window);`;
}

function filterRemotes(src, remotes) {
	// return -1 for not remote
	// return 0 for undownloadable remote
	// return 1 for downloadable remote
	const host = new URL(src, "a://").host;
	if (!host) return -1;
	if (!remotes) return 0;
	if (remotes.some((rem) => {
		if (host.indexOf(rem) >= 0) return true;
	})) return 1;
	else return 0;
}

function filterByName(src, list) {
	if (!list) return;
	const found = list.some((str) => {
		if (str == ".") return false;
		if (str.indexOf('*') >= 0) return minimatch(src, str);
		else return src.indexOf(str) >= 0;
	});
	if (found) debug("excluded", src);
	return found;
}

function filterByExt(list, ext) {
	if (!list) return [];
	ext = '.' + ext;
	return list.filter((src) => {
		return Path.extname(new URL(src, "a://").pathname) == ext;
	});
}

function removeNodeAndSpaceBefore(node) {
	let cur = node.previousSibling;
	while (cur && cur.nodeType == 3 && /^\s*$/.test(cur.nodeValue)) {
		cur.remove();
		cur = node.previousSibling;
	}
	node.remove();
}

function spaceBefore(node) {
	let str = "";
	let cur = node.previousSibling, val;
	while (cur && cur.nodeType == 3) {
		val = cur.nodeValue;
		let nl = /([\n\r]*[\s]*)/.exec(val);
		if (nl && nl.length == 2) {
			val = nl[1];
			nl = true;
		} else {
			nl = false;
		}
		str = val + str;
		if (nl) break;
		cur = cur.previousSibling;
	}
	return node.ownerDocument.createTextNode(str);
}

function createSibling(refnode, direction, tag, attrs) {
	const node = refnode.ownerDocument.createElement(tag);
	if (attrs) for (const name in attrs) node.setAttribute(name, attrs[name]);
	refnode[direction](node);
	refnode[direction](spaceBefore(refnode));
	return node;
}

function prependToPivot(scripts, list, tag, att, ext, attrs) {
	list = filterByExt(list, ext);
	if (!list.length) return;
	const pivot = scripts[0];
	if (!pivot) {
		// eslint-disable-next-line no-console
		console.error("Missing node to prepend to", list);
		return;
	}
	attrs = Object.assign({}, attrs);
	list.forEach((src) => {
		attrs[att] = src;
		scripts.unshift(createSibling(pivot, 'before', tag, attrs));
		debug("prepended", tag, att, src);
	});
}

function appendToPivot(scripts, list, tag, att, ext, attrs) {
	list = filterByExt(list, ext);
	if (!list.length) return;
	const pivot = scripts.slice(-1)[0];
	if (!pivot) {
		// eslint-disable-next-line no-console
		console.error("Missing node to append to", list);
		return;
	}
	attrs = Object.assign({}, attrs);
	while (list.length) {
		const src = list.pop();
		attrs[att] = src;
		scripts.push(createSibling(pivot, 'after', tag, attrs));
		debug("appended", tag, att, src);
	}
	return pivot;
}

async function loadDom(path, basepath) {
	if (!basepath) basepath = path;
	else basepath = Path.join(basepath, Path.basename(path));
	const html = await readFile(path);

	const abspath = Path.resolve(basepath);
	const dom = new JSDOM(html, {
		url: `file://${abspath}`
	});
	dom.basepath = abspath;
	return dom;
}

async function readFile(path) {
	const buf = await fs.readFile(path);
	return buf.toString();
}

async function writeFile(path, buf) {
	await mkdirp(Path.dirname(path));
	await fs.writeFile(path, buf);
}

function resolverPlugin({ modulesPrefix = "/", modulesRoot = ".", root = "." }, key, type) {
	if (!modulesPrefix.startsWith('/')) modulesPrefix = '/' + modulesPrefix;
	const resolver = new Resolver({
		root: modulesRoot,
		prefix: modulesPrefix
	});
	const absRoot = Path.resolve(root);
	const regModules = /^[./]*node_modules\//;
	return {
		name: "native import modules resolver",
		async [key](source, importer) {
			if (!importer) return null;
			const usource = Path.toUnix(source);
			let ignore = source.includes('\0') || importer.includes('\0');
			let importerDir;
			if (!ignore) {
				importerDir = Path.relative(
					absRoot,
					Path.extname(importer) ? Path.dirname(importer) : importer
				);
				ignore = importerDir.includes("/node_modules/") || regModules.test(usource) == false;
			}
			if (ignore) {
				// let other resolvers work
				if (type == "js") {
					return null;
				} else if (type == "css") {
					return usource;
				}
			}
			const browserPath = usource.startsWith(modulesPrefix)
				? usource
				: Path.join('/', importerDir, usource);
			const res = await resolver.resolve(browserPath, type);
			if (!res.path) throw new Error(`Cannot resolve ${source} from ${modulesPrefix}`);
			return Path.resolve(res.path);
		}
	};
}

