"use strict";

// debug mode
const isDebug = false,
	  IS_TO_STR = true; 

const fs = require('fs'),
	_ = require('lodash'),
	path = require('path'),
	minify = require('html-minifier').minify,
	utils = require('./libs/utils'),
	errors = require('./libs/errors'),
	loaderUtils = require('loader-utils');

function HtmlResWebpackPlugin(options) {

	// user input options
	this.options = _.extend({
		mode: options.mode || 'default', // default => 配置 html => 写在html中
		filename: options.filename || '',
		chunks: options.chunks || [],
		htmlMinify: options.htmlMinify || false,
		favicon: options.favicon || false,
		templateContent: options.templateContent || function(tpl) { return tpl },
		cssPublicPath: options.cssPublicPath || null,
		// 字符串替换规则
		replace: options.replace || [ ]
	}, options);

	this.logChunkName = true;

	this.checkRequiredOptions(this.options);

	if ( this.options.replace.length === undefined )
		throw 'HtmlResWebpackPlugin "options.replace" should be an Array instance.';

	// html scripts/css/favicon assets
	this.stats = {
		assets: [],
	};
	this.webpackOptions = {};
}

/**
 * check required options
 * @param  {[type]} options [description]
 * @return {[type]}         [description]
 */
HtmlResWebpackPlugin.prototype.checkRequiredOptions = function(options) {
	var requireOptions = ['filename', 'template', 'chunks'],
		count = 0,
		requiredOption = '';

	for (let option in options) {
		if (!!~requireOptions.indexOf(option)) {
			count++;
			requiredOption = option;
		}
	}

	if (count < requireOptions.length) {
		throw new errors.optionRequredErr(requiredOption);
	}
};

/**
 * [plugin init]
 * @param  {[type]}   compiler [compiler]
 * @param  {Function} callback [async callback]
 */
HtmlResWebpackPlugin.prototype.apply = function(compiler, callback) {

  	compiler.plugin("make", function(compilation, callback) {
	    isDebug && console.log("==================make================");
	    callback();
	});


  	// right after emit, files will be generated
	compiler.plugin("emit", (compilation, callback) => {
	    isDebug && console.log("===================emit===============");
	    // return basename, ie, /xxx/xxx.html return xxx.html
	    this.options.htmlFileName = this.addFileToWebpackAsset(compilation, this.options.template, utils.getBaseName(this.options.template, this.options.filename), IS_TO_STR);

	    // inject favicon
	    if (this.options.favicon) {
	    	this.options.faviconFileName = this.addFileToWebpackAsset(compilation, this.options.template, utils.getBaseName(this.options.favicon, null));
	    }

	    // webpack options
	    this.webpackOptions = compilation.options;

	    if (this.options.mode === 'default') {
	    	this.buildStats(compilation);
		    // start injecting resource into html
		    this.injectAssets(compilation);
		}
		else if (this.options.mode === 'html') {
			this.buildStatsHtmlMode(compilation);
			// process
			this.processAssets(compilation);
		}

		// html string replace
		this.handleReplace( compilation );

	    // compress html content
	    this.options.htmlMinify && this.compressHtml(compilation);
	    
	    callback();
	});

};

HtmlResWebpackPlugin.prototype.buildStatsHtmlMode = function(compilation) {
	compilation.chunks.map((chunk, key) => {
		this.stats.assets[chunk.name] = chunk.files;
	});

	let assets = Object.keys(compilation.assets) || [];

	assets.map((asset, key) => {
		let chunkName = compilation.assets[asset].chunk || null;
		if (chunkName) {
			if (!!~chunkName.indexOf(".")) {
				chunkName = chunkName.substr(0, chunkName.lastIndexOf('.'));
			}
			this.stats.assets[chunkName] = [asset];
		}
	});

	if (!this.logChunkName) {
		return;
	}

	this.logChunkName = false;
	console.log("=====html-res-webapck-plugin=====");
	Object.keys(this.stats.assets).map((chunk, key) => {
		console.log("chunk" + (key + 1) + ": " + chunk);
	});
};

/**
 * find resources related the html
 * @param  {[type]} compilation [description]
 * @return {[type]}             [description]
 */
HtmlResWebpackPlugin.prototype.buildStats = function(compilation) {
	// array and object are allowed
	let optionChunks = this.options.chunks,
		injectChunks = _.isArray(optionChunks) ? optionChunks : Object.keys(optionChunks);

	compilation.chunks.map((chunk, key) => {
		if (!!~injectChunks.indexOf(chunk.name)) {
			this.stats.assets[chunk.name] = chunk.files;
		}
	});

	/**
	 * compatible with copy-webpack-plugin / copy-webpack-plugin-hash                                 [description]
	 */
	
	if (!compilation.assets) {
		return;
	}

	Object.keys(compilation.assets).map((assetKey, key) => {
		let files = [],
			asset = compilation.assets[assetKey],
			chunk = (asset.hasOwnProperty('chunk')) ? asset.chunk : "",
			ext = path.extname(chunk);
		
		chunk = chunk.replace(ext, "");

		if (!!~injectChunks.indexOf(chunk)) {
			this.stats.assets[chunk] = files.concat(assetKey);
		}
	});

	// console.log(this.stats.assets);
};

HtmlResWebpackPlugin.prototype.handleReplace = function ( compilation ) {

	if ( ! this.options.replace.length ) return;

	let the = this;
	let htmlContent = compilation.assets[ the.options.htmlFileName ].source();

	this.options.replace.forEach( ( el, inx ) => {
		htmlContent = htmlContent.replace( el.search, el.replace );
	} );

	compilation.assets[ the.options.htmlFileName ].source = () => {
		return this.options.templateContent.bind( this )( htmlContent );
	};
};

/**
 * [process html script/link tags]
 * @param  {[type]} compilation [compilation]
 */
HtmlResWebpackPlugin.prototype.processAssets = function(compilation) {
	var htmlContent = compilation.assets[this.options.htmlFileName].source(),
		publicPath = this.webpackOptions.output.publicPath;

	// console.log(this.stats.assets);
	// console.log(htmlContent);
	
	// css inline
	let styleInlineRegex = new RegExp("<link.*href=[\"|\']*(.+)[\?]\_\_inline.*?[\"|\']>", "ig");
	htmlContent = this.inlineHtmlRes(htmlContent, styleInlineRegex, compilation, 'css'); 

	// js liline
	let scriptInlineRegex = new RegExp("<script.*src=[\"|\']*(.+)[\?]\_\_inline.*?[\"|\']><\/script>", "ig");
	htmlContent = this.inlineHtmlRes(htmlContent, scriptInlineRegex, compilation, 'js');

	// css
	let styleMd5Regex = new RegExp("<link.*href=[\"|\']*(.+).*?[\"|\']>", "ig");
	let cssPublicPath = this.options.cssPublicPath || publicPath;
	htmlContent = this.md5HtmlRes(htmlContent, styleMd5Regex, cssPublicPath, "css");

	// favico
	htmlContent = this.md5HtmlRes(htmlContent, styleMd5Regex, publicPath, "ico");
	
	// js
	let scriptMd5Regex = new RegExp("<script.*src=[\"|\']*(.+).*?[\"|\']><\/script>", "ig");
	htmlContent = this.md5HtmlRes(htmlContent, scriptMd5Regex, publicPath, "js");

	compilation.assets[this.options.htmlFileName].source = () => {
		return this.options.templateContent.bind(this)(htmlContent);
	};
};

HtmlResWebpackPlugin.prototype.md5HtmlRes = function(htmlContent, reg, publicPath, extension) {
	let _this = this;

	htmlContent = htmlContent.replace(reg, function(tag, route) {
		
		if (extension === "ico" && !!~route.indexOf("." + extension)) {
			tag = tag.replace(route, publicPath + route);
			return tag;
		}

		var assets = _this.stats.assets[route] || [],
			file = "";

		if (!assets.length) {
			return tag;
		}

		assets.forEach(function(item, index) {
			if (!!~item.indexOf("." + extension) && !file) {
				file = item;
			}
		});

		tag = tag.replace(route, publicPath + file);

		return tag;
	});

	return htmlContent;
};

HtmlResWebpackPlugin.prototype.inlineHtmlRes = function(htmlContent, reg, compilation, extension) {
	let _this = this;

	htmlContent = htmlContent.replace(reg, function(tag, route) {
		// console.log(tag, route);
		var assets = _this.stats.assets[route] || [],
			file = "";

		if (!assets.length) {
			return tag;
		}

		assets.forEach(function(item, index) {

			if (!!~item.indexOf("." + extension) && extension === "js") {
				file = "<script>" + compilation.assets[item].source() + "</script>";
			}
			else if (!!~item.indexOf("." + extension) && extension === "css") {
				file = "";
				let cssContent = "";
				compilation.assets[item].children.forEach(function(item, key) {
					cssContent += item._value;
				}) ;
				file = "<style>" + cssContent + "</style>";
			}
		});

		tag = tag.replace(tag, file);

		return tag;
	});

	return htmlContent;
};

/**
 * inject assets into html file
 * @param  {[type]} compilation [description]
 * @return {[type]}             [description]
 */
HtmlResWebpackPlugin.prototype.injectAssets = function(compilation) {
	let htmlContent = compilation.assets[this.options.htmlFileName].source(),
		styleContent = "",
		scriptContent = "",
		faviconContent = "",
		publicPath = this.webpackOptions.output.publicPath,
		optionChunks = this.options.chunks,
		injectChunks = _.isArray(optionChunks) ? optionChunks : Object.keys(optionChunks);

	let loopKeys = Object.keys(this.stats.assets);
	// use injectChunks in order to allow user to control occurences of file order
	injectChunks.map((chunkKey, key1) => {
		
		if (!this.stats.assets.hasOwnProperty(chunkKey)) {
			this.stats.assets[chunkKey] = [optionChunks[chunkKey].res];
		}
		// console.log(this.stats.assets);
		this.stats.assets[chunkKey].map((file, key2) => {
			let fileType = utils.getFileType(file),
				isExternal = (optionChunks[chunkKey] && optionChunks[chunkKey].external) || false;
			
			switch(fileType) {
				case 'js':
					let jsInline = false;
					if (!_.isArray(optionChunks)) {
						jsInline = this.inlineRes(compilation, optionChunks[chunkKey], file, fileType);
					}

					let jsAttr = (_.isArray(optionChunks)) ? '' :  this.injectAssetsAttr(optionChunks[chunkKey], fileType),
					    srcPath = (isExternal) ? file : publicPath + file;
					scriptContent += (jsInline) ? 
									('<script ' + jsAttr + ' >' + jsInline + '</script>')
									: ('<script ' + jsAttr + ' type="text/javascript" src="' + srcPath + '"></script>\n');
					break;
				case 'css':
					let styleInline = false;
					if (!_.isArray(optionChunks)) {
						styleInline = this.inlineRes(compilation, optionChunks[chunkKey], file, fileType);
					}

					let styleAttr = (_.isArray(optionChunks)) ? '' :  this.injectAssetsAttr(optionChunks[chunkKey], fileType),
						hrefPath = (isExternal) ? file : publicPath + file;
					styleContent += (styleInline) ? 
									('<style ' + styleAttr + '>' + styleInline + '</style>')
									: ('<link ' + styleAttr + ' rel="stylesheet" href="' + hrefPath + '">\n');
					break;
				case 'ico':
					break;
			}
		});
	});

	// inject favicon
	if (this.options.favicon) {
		faviconContent = '<link rel="shortcut icon" type="image/x-icon" href="' + publicPath + this.options.faviconFileName + '">\n'
    				      + '<link rel="icon" type="image/x-icon" href="' + publicPath + this.options.faviconFileName + '">\n'
	}
	// console.log(compilation.assets[this.options.htmlFileName].source());
	htmlContent = htmlContent.replace("</head>", faviconContent + "</head>").replace("</head>", styleContent + "</head>").replace("</body>", scriptContent + "</body>");
	
	let htmlAssetObj = compilation.assets[this.options.htmlFileName];
	compilation.assets[this.options.htmlFileName] = _.merge(htmlAssetObj, {
		source: () => {
			return this.options.templateContent.bind(this)(htmlContent);
		}
	});
};

/**
 * inject resource attributes
 * @param  {[type]} chunk    [description]
 * @param  {[type]} fileType [description]
 * @return {[type]}          [description]
 */
HtmlResWebpackPlugin.prototype.injectAssetsAttr = function(chunk, fileType) {
	if (!chunk || !chunk.hasOwnProperty('attr') || !chunk.attr) {
		return '';
	}

	return chunk.attr[fileType] || '';
};

/**
 * inline resource
 * @param  {[type]} compilation [description]
 * @param  {[type]} chunk       [description]
 * @param  {[type]} file        [description]
 * @param  {[type]} fileType    [description]
 * @return {[type]}             [description]
 */
HtmlResWebpackPlugin.prototype.inlineRes = function(compilation, chunk, file, fileType) {
	if (!chunk || !chunk.hasOwnProperty('inline') || !chunk.inline || !chunk.inline[fileType]) {
		return false;
	}

	return compilation.assets[file].source();
};

/**
 * use webpack to generate files when it is in dev mode
 * @param {[type]}  compilation [description]
 * @param {[type]}  template    [description]
 * @param {Boolean} isToStr     [description]
 */
HtmlResWebpackPlugin.prototype.addFileToWebpackAsset = function(compilation, template, basename, isToStr) {
	var filename = path.resolve(template);
	
    compilation.fileDependencies.push(filename);
    compilation.assets[basename] = {
    	source: () => {
    		let fileContent = (isToStr) ? fs.readFileSync(filename).toString() : fs.readFileSync(filename);
      		return fileContent;
      	},
      	size: () => {
      		return fs.statSync(filename).size;
      	}
    };

    return basename;
};

/**
 * compress html files
 * @param  {[type]} compilation [description]
 * @return {[type]}             [description]
 */
HtmlResWebpackPlugin.prototype.compressHtml = function(compilation) {
	let htmlFileName = this.options.htmlFileName,
		htmlContent = compilation.assets[htmlFileName].source(),
		htmlAsset = compilation.assets[htmlFileName];

	compilation.assets[htmlFileName] = Object.assign(htmlAsset, {
		source: () => {
			return minify(htmlContent, this.options.htmlMinify);
		}
	});
};

module.exports = HtmlResWebpackPlugin;
