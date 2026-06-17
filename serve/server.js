const { dirname, relative, join, resolve, normalize } = require("upath");
const fs = require("fs");
const nodeResolve = require("resolve");
const crypto = require("crypto");
const { Parser } = require("acorn");
const MyParser = Parser
	.extend(require('acorn-private-methods'))
	.extend(require('acorn-class-fields'));
const walk = require("acorn-walk");


class Cached {
	constructor(content, mimetype) {
		this.content = content;
		this.headers = {
			"content-type": mimetype + "; charset=utf-8",
			"etag": '"' + hash(content) + '"'
		};
	}
}

class ModuleServer {
	constructor({ prefix = "/", root = ".", maxDepth, modules }) {
		this.modules = modules;
		this.maxDepth = maxDepth == null ? 1 : maxDepth;
		this.prefix = join(prefix, "node_modules", "/");
		this.root = resolve(root, "node_modules");
		this.cache = Object.create(null);
	}

	handleRequest(req, res) {
		const send = (status, text, headers) => {
			const hds = {};
			if (!headers || typeof headers == "string") {
				hds["content-type"] = headers || "text/plain";
			} else {
				Object.assign(hds, headers);
			}
			res.writeHead(status, hds);
			res.end(text);
		};
		const url = new URL(req.baseUrl + req.url, "http://localhost");
		if (url.pathname.startsWith(this.prefix) == false) return false;
		// Modules paths in URLs represent "up one directory" as "__".
		// Convert them to ".." for filesystem path resolution.
		const relUrl = undash(url.pathname.substring(this.prefix.length));
		let cached = this.cache[relUrl];
		if (!cached) {
			if (countParentRefs(relUrl) > this.maxDepth) {
				send(403, "Access denied");
				return true;
			}
			const fullPath = resolve(this.root, relUrl);
			let code;
			try {
				code = fs.readFileSync(fullPath, "utf8");
			} catch {
				send(404, "Not found");
				return true;
			}
			if (/\.map$/.test(fullPath)) {
				cached = this.cache[relUrl] = new Cached(code, "application/json");
			} else {
				const { code: resolvedCode, error } = this.resolveImports(fullPath, code);
				if (error) throw error;
				cached = this.cache[relUrl] = new Cached(resolvedCode, "application/javascript");
			}
			// Drop cache entry when the file changes.
			const watching = fs.watch(fullPath, () => {
				watching.close();
				this.cache[relUrl] = null;
			});
			// let node >= 12.20.0 exit
			if (watching.unref) watching.unref();
		}
		const noneMatch = req.headers["if-none-match"];
		if (noneMatch && noneMatch.indexOf(cached.headers.etag) > -1) {
			send(304, null);
			return true;
		}
		send(200, cached.content, cached.headers);
		return true;
	}

	// Resolve a module path to a relative filepath where
	// the module's file exists.
	resolveModule(basePath, path) {
		let resolved;
		try { resolved = this.resolveMod(path, basePath); }
		catch (e) { return { error: e.toString() }; }

		// Builtin modules resolve to strings like "fs". Try again with
		// slash which makes it possible to locally install an equivalent.
		if (resolved.indexOf("/") == -1) {
			try { resolved = this.resolveMod(join(path, "/"), basePath); }
			catch (e) { return { error: e.toString() }; }
		}

		return { path: join("/", this.prefix, relative(this.root, resolved)) };
	}

	resolveImports(basePath, code) {
		basePath = fs.realpathSync(basePath);
		const patches = [];
		let ast;
		try {
			ast = MyParser.parse(code, { sourceType: "module", ecmaVersion: "latest" });
		} catch (err) {
			return { error: err.toString() + " in " + basePath };
		}
		let isModule = false;
		let isCommonjs = false;

		const patchSrc = (node) => {
			isModule = true;
			if (!node.source) return;
			const orig = (0, eval)(code.slice(node.source.start, node.source.end));
			const { error, path } = this.resolveModule(dirname(basePath), orig);
			if (error) return { error };
			patches.push({
				from: node.source.start,
				to: node.source.end,
				text: JSON.stringify(dash(path))
			});
		};

		walk.simple(ast, {
			ExportAllDeclaration: () => isModule = true,
			ExportDefaultDeclaration: () => isModule = true,
			ExportNamedDeclaration: patchSrc,
			ImportDeclaration: patchSrc,
			ImportExpression: node => {
				isModule = true;
				if (node.source.type == "Literal") {
					const { error, path } = this.resolveModule(
						dirname(basePath), node.source.value
					);
					if (!error) {
						patches.push({
							from: node.source.start,
							to: node.source.end,
							text: JSON.stringify(dash(path))
						});
					}
				}
			},
			AssignmentExpression: node => {
				const names = getAssignmentNames(node.left);
				if (names[0] == "module" && names[1] == "exports" || names[0] == "exports") {
					isCommonjs = true;
				}
			},
			VariableDeclaration: node => {
				if (!node.declarations) return;
				const reqs = [];
				let noreqs = 0;
				for (const decl of node.declarations) {
					if (!decl.init || decl.init.type != "CallExpression" || !decl.init.callee || decl.init.callee.name != "require") {
						noreqs++;
						continue;
					}
					const args = decl.init.arguments[0];
					if (!args) {
						continue; // ? anyway we don't wan't to crash on this ?
					}
					const { error, path } = this.resolveModule(
						dirname(basePath),
						args.value
					);
					if (error) return { error };
					const str = `import ${decl.id.name} from ${JSON.stringify(dash(path))};`;
					reqs.push(str);
				}
				if (reqs.length == 0) return;
				if (noreqs > 0) {
					return {
						error: "moduleserver does not support yet rewriting mixed variable/require declarations"
					};
				}
				patches.push({
					from: node.start,
					to: node.end,
					text: ""
				});
				reqs.forEach(req => patches.push({
					from: node.start,
					to: node.start,
					text: req
				}));
			}
		}, {
			...walk.base,
			FieldDefinition: () => { },
			PropertyDefinition: () => { }
		});
		if (!isModule && isCommonjs) {
			patches.push({
				from: ast.start,
				to: ast.start,
				text: 'const module = {exports: {}};let exports = module.exports'
					+ (code.charAt(ast.start) == ";" ? "" : ";")
			});
			patches.push({
				from: ast.end,
				to: ast.end,
				text: (code.charAt(ast.end - 1) == ";" ? "" : ";")
					+ 'export default module.exports'
			});
		}
		for (const patch of patches.sort((a, b) => b.from - a.from)) {
			code = code.slice(0, patch.from) + patch.text + code.slice(patch.to);
		}
		return { code };
	}

	packageFilter(pkg) {
		const mod = this.modules[pkg.name];
		if (mod && mod.js && mod.js['.']) {
			pkg.main = mod.js['.'];
		} else if (pkg.module) {
			pkg.main = pkg.module;
		} else if (pkg['jsnext:main']) {
			pkg.main = pkg.jsnext;
		}
		return pkg;
	}
	resolveMod(path, base) {
		return normalize(nodeResolve.sync(path, {
			basedir: base,
			packageFilter: (pkg) => this.packageFilter(pkg)
		}));
	}
}
module.exports = ModuleServer;

function dash(path) { return path.replace(/(^|\/)\.\.(?=$|\/)/g, "$1__"); }
function undash(path) { return path.replace(/(^|\/)__(?=$|\/)/g, "$1.."); }

function hash(str) {
	const sum = crypto.createHash("sha1");
	sum.update(str);
	return sum.digest("hex");
}

function countParentRefs(path) {
	const re = /(^|\/)\.\.(?=\/|$)/g;
	let count = 0;
	while (re.exec(path)) count++;
	return count;
}

function getAssignmentNames(left, names = []) {
	if (left.type == "Identifier") {
		names.push(left.name);
	} else if (left.type == "MemberExpression") {
		getAssignmentNames(left.object, names);
		if (left.property && left.property.type == "Identifier" && left.property.name) {
			names.push(left.property.name);
		}
	}
	return names;
}
