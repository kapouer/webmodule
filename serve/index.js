const path = require('upath');
const serveStatic = require('serve-static');
const Resolver = require('@webmodule/resolve');
const ModuleServer = require("./server");
const HttpError = require('http-errors');

module.exports = function ({ prefix = "/", root = ".", modules = {} } = {}) {
	const serveHandler = serveStatic(root, {
		index: false,
		redirect: false,
		dotfiles: 'ignore',
		fallthrough: false
	});
	const reqPrefix = path.join(prefix, "node_modules", "/");
	const resolver = new Resolver({ prefix, root, modules });
	const moduleServer = new ModuleServer({ prefix, root, modules });

	return async function serveModule(req, res, next) {
		const reqPath = req.baseUrl + req.path;
		if (req.method !== "GET" || !reqPath.startsWith(reqPrefix)) {
			return next('route');
		}
		if (req.app.settings.env !== "development") {
			console.warn("This route is forbidden when not in development", reqPrefix);
			return next(new HttpError.NotFound());
		}

		const ext = path.extname(reqPath).substring(1);

		const ref = req.headers.referer || "";
		if (ext && /^m?js$/.test(ext) && /\.m?js$/.test(ref)) {
			try {
				if (!await moduleServer.handleRequest(req, res)) res.sendStatus(404);
			} catch (err) {
				next(err);
			}
			return;
		}

		const accepts = /\btext\/css\b/.test(req.get('accept') || "*/*") ? "css" : "js";
		try {
			const { url } = await resolver.resolve(reqPath, accepts);

			res.vary('Accept');

			if (url) {
				if (accepts === "css") {
					// else browser warns about content-type
					res.location(url);
					res.status(302);
					res.type('text/css');
					res.end();
				} else {
					res.redirect(url);
				}
			} else {
				// eslint-disable-next-line require-atomic-updates
				req.url = reqPath;
				serveHandler(req, res, next);
			}
		} catch (err) {
			console.error(err);
			return next(err);
		}
	};
};



