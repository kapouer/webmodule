const assert = require('assert');
const express = require('express');

const serveModule = require('..');


const app = express();

app.use(serveModule({
	prefix: '/',
	root: "."
}));

app.get('/', req => {
	req.res.type("html");
	req.res.end(`<!DOCTYPE html>
		<html>
		<head>
			<title>test import</title>

			<script src="/node_modules/oidc-client-ts/dist/browser/oidc-client-ts.js"></script>

		</head>
		<body>
		test
		</body>
	</html>`);
});

const server = app.listen(8080);
