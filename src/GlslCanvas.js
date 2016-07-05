/*
The MIT License (MIT)

Copyright (c) 2015 Patricio Gonzalez Vivo ( http://www.patriciogonzalezvivo.com )

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the 'Software'), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import { initGL } from './gl/gl';
import { isCanvasVisible, parseUniforms, isDiff } from './tools/common';
import { subscribeMixin } from './tools/mixin';

import xhr from 'xhr';
import Texture from './gl/texture';
import Fbo from './gl/fbo';
import Shader from './gl/shader';

export default class GlslCanvas {
    constructor(canvas, options) {
        subscribeMixin(this);

        options = options || {};

        this.width = canvas.clientWidth;
        this.height = canvas.clientHeight;
        this.timeLoad = Date.now();

        this.canvas = canvas;
        this.gl = undefined;
        this.shader = undefined;
        
        this.vbo = {};

        // GL Context
        let gl = initGL(canvas, options);
        if (!gl) {
            return;
        }
        this.gl = gl;
        this.shader = new Shader(this.gl);

        if (options.fragmentString || options.vertexString) {
            this.shader.load(options.fragmentString,options.vertexString)
        }
        
        this.forceRender = true;
        this.paused = false;

        // Allow alpha
        canvas.style.backgroundColor = options.backgroundColor || 'rgba(1,1,1,0)';

        // Load shader
        if (canvas.hasAttribute('data-fragment')) {
            this.shader.fragmentString = canvas.getAttribute('data-fragment');
        }
        else if (canvas.hasAttribute('data-fragment-url')) {
            let source = canvas.getAttribute('data-fragment-url');
            xhr.get(source, (error, response, body) => {
                this.load(body, this.shader.vertexString);
            });
        }

        // Load shader
        if (canvas.hasAttribute('data-vertex')) {
            this.shader.vertexString = canvas.getAttribute('data-vertex');
        }
        else if (canvas.hasAttribute('data-vertex-url')) {
            let source = canvas.getAttribute('data-vertex-url');
            xhr.get(source, (error, response, body) => {
                this.load(this.shader.fragmentString, body);
            });
        }

        // Define Vertex buffer
        let texCoordsLoc = this.shader.attribute('a_texcoord');
        this.vbo.texCoords = gl.createBuffer();
        this.gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo.texCoords);
        this.gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0]), gl.STATIC_DRAW);
        this.gl.enableVertexAttribArray(texCoordsLoc);
        this.gl.vertexAttribPointer(texCoordsLoc, 2, gl.FLOAT, false, 0, 0);

        let verticesLoc = this.shader.attribute('a_position');
        this.vbo.vertices = gl.createBuffer();
        this.gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo.vertices);
        this.gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0]), gl.STATIC_DRAW);
        this.gl.enableVertexAttribArray(verticesLoc);
        this.gl.vertexAttribPointer(verticesLoc, 2, gl.FLOAT, false, 0, 0);

        // load TEXTURES
        this.textures = {};
        if (canvas.hasAttribute('data-textures')) {
            let imgList = canvas.getAttribute('data-textures').split(',');
            for (let nImg in imgList) {
                this.shader.setUniform('u_tex' + nImg, imgList[nImg]);
            }
        }

        // ========================== EVENTS
        let mouse = {
            x: 0,
            y: 0
        };
        document.addEventListener('mousemove', (e) => {
            mouse.x = e.clientX || e.pageX;
            mouse.y = e.clientY || e.pageY;
        }, false);

        let sandbox = this;
        function RenderLoop() {
            sandbox.setMouse(mouse);
            sandbox.render();
            sandbox.forceRender = sandbox.resize();
            window.requestAnimationFrame(RenderLoop);
        }

        // Start
        this.setMouse({ x: 0, y: 0 });
        RenderLoop();
        return this;
    }

    load (fragString, vertString) {
        this.shader.load(fragString, vertString);

        this.change = true;

        // Trigger event
        this.trigger('load', {});

        this.forceRender = true;
    }

    destroy() {
        for (let tex in this.textures) {
            this.gl.deleteTexture(tex);
        }
        this.textures = {};
        this.shader.destroy();
        this.gl = null;
    }

    loadTexture (name, urlElementOrData, options) {
        if (!options) {
            options = {};
        }

        if (typeof urlElementOrData === 'string') {
            options.url = urlElementOrData;
        }
        else if (typeof urlElementOrData === 'object' && urlElementOrData.data && urlElementOrData.width && urlElementOrData.height) {
            options.data = urlElementOrData.data;
            options.width = urlElementOrData.width;
            options.height = urlElementOrData.height;
        }
        else if (typeof urlElementOrData === 'object') {
            options.element = urlElementOrData;
        }
        this.textures[name] = new Texture(this.gl, name, options);
        this.textures[name].on('loaded', (args) => {
            this.forceRender = true;
        });
    }

    setUniform(name, ...value) {
        let u = {};
        u[name] = value;
        this.setUniforms(u);
    }

    setUniforms(uniforms) {
        let parsed = parseUniforms(uniforms);
        // Set each uniform
        for (let u in parsed) {
            if (parsed[u].type === 'sampler2D') {
                // For textures, we need to track texture units, so we have a special setter
                this.uniformTexture(parsed[u].name, parsed[u].value[0]);
            }
            else {
                this.shader.uniform(parsed[u].method, parsed[u].type, parsed[u].name, parsed[u].value);
                this.forceRender = true;
            }
        }
    }

    uniformTexture(name, texture, options) {
        if (this.textures[name] === undefined) {
            this.loadTexture(name, texture, options);
        }
        else {
            this.shader.uniform('1i', 'sampler2D', name, this.texureIndex);
            this.textures[name].bind(this.texureIndex);
            this.shader.uniform('2f', 'vec2', name + 'Resolution', this.textures[name].width, this.textures[name].height);
            this.texureIndex++;
        }
    }

    setMouse(mouse) {
        // set the mouse uniform
        let rect = this.canvas.getBoundingClientRect();
        if (mouse &&
            mouse.x && mouse.x >= rect.left && mouse.x <= rect.right &&
            mouse.y && mouse.y >= rect.top && mouse.y <= rect.bottom) {
            this.shader.uniform('2f', 'vec2', 'u_mouse', mouse.x - rect.left, this.canvas.height - (mouse.y - rect.top));
        }
    }

    resize() {
        if (this.width !== this.canvas.clientWidth ||
            this.height !== this.canvas.clientHeight) {
            let realToCSSPixels = window.devicePixelRatio || 1;

            // Lookup the size the browser is displaying the canvas in CSS pixels
            // and compute a size needed to make our drawingbuffer match it in
            // device pixels.
            let displayWidth = Math.floor(this.gl.canvas.clientWidth * realToCSSPixels);
            let displayHeight = Math.floor(this.gl.canvas.clientHeight * realToCSSPixels);

            // Check if the canvas is not the same size.
            if (this.gl.canvas.width !== displayWidth ||
                this.gl.canvas.height !== displayHeight) {
                // Make the canvas the same size
                this.gl.canvas.width = displayWidth;
                this.gl.canvas.height = displayHeight;
                // Set the viewport to match
                this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
                // this.gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
            }
            this.width = this.canvas.clientWidth;
            this.height = this.canvas.clientHeight;
            return true;
        }
        else {
            return false;
        }
    }

    render () {
        this.visible = isCanvasVisible(this.canvas);
        if (this.forceRender ||
            (this.shader.animated && this.visible && ! this.paused)) {
            // set the time uniform
            let timeFrame = Date.now();
            let time = (timeFrame - this.timeLoad) / 1000.0;
            this.shader.uniform('1f', 'float', 'u_time', time);

            // set the resolution uniform
            this.shader.uniform('2f', 'vec2', 'u_resolution', this.canvas.width, this.canvas.height);

            this.texureIndex = 0;
            for (let tex in this.textures) {
                this.uniformTexture(tex);
            }

            // Draw the rectangle.
            this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

            // Trigger event
            this.trigger('render', {});

            this.change = false;
            this.forceRender = false;
        }
    }

    pause () {
        this.paused = true;
    }

    play () {
        this.paused = false;
    }

    version() {
        return '0.1.0';
    }
}

window.GlslCanvas = GlslCanvas;

function loadAllGlslCanvas() {
    var list = document.getElementsByClassName('glslCanvas');
    if (list.length > 0) {
        window.glslCanvases = [];
        for (var i = 0; i < list.length; i++) {
            var sandbox = new GlslCanvas(list[i]);
            window.glslCanvases.push(sandbox);
        }
    }
}

window.addEventListener('load', function () {
    loadAllGlslCanvas();
});
