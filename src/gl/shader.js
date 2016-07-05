import { subscribeMixin } from '../tools/mixin';
import { default as parseShaderErrors } from 'gl-shader-errors';
import { isDiff } from '../tools/common';

export default class Shader {
    constructor(gl) {
        subscribeMixin(this);

        this.gl = gl;
        this.program = undefined;
        this.uniforms = {}; // program locations of uniforms, lazily added as each uniform is set
        this.attribs = {}; // program locations of vertex attributes, lazily added as each attribute is accessed
        this.animated = false;
        this.compiled = false;
        this.id = Shader.id++;
        Shader.programs[this.id] = this;

        this.vertexString = `
#ifdef GL_ES
precision mediump float;
#endif

attribute vec2 a_position;
attribute vec2 a_texcoord;

varying vec2 v_texcoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texcoord = a_texcoord;
}
`;
        this.fragmentString = `
#ifdef GL_ES
precision mediump float;
#endif

varying vec2 v_texcoord;

void main(){
    gl_FragColor = vec4(0.0);
}
`;
        this.load();
    }

    destroy() {
        this.gl.useProgram(null);
        this.gl.deleteProgram(this.program);
        this.program = null;

        for (let att in this.attribs) {
            this.gl.deleteBuffer(this.attribs[att]);
        }
        this.compiled = false;
    }

    load (fragString, vertString) {
        // Load vertex/fragment shader if there is one
        this.vertexString = vertString || this.vertexString;
        this.fragmentString = fragString || this.fragmentString;
        this.animated = false;

        try {
            this.program = Shader.updateProgram(this.gl, this.program, this.vertexString, this.fragmentString);
            this.compiled = true;
        }
        catch(error) {
            this.program = null;
            this.compiled = false;
            this.trigger('error', error);
        }

        // Is this shader need to be animated
        let nTimes = (this.fragmentString.match(/u_time/g) || []).length;
        let nMouse = (this.fragmentString.match(/u_mouse/g) || []).length;
        this.animated = nTimes > 1 || nMouse > 1;

        this.use();
    }

    use() {
        if (!this.compiled) {
            return;
        }

        if (Shader.current !== this) {
            this.gl.useProgram(this.program);
        }
        Shader.current = this;
    }

    refreshUniforms() {
        this.uniforms = {};
    }

    uniform (method, type, name, ...value) { // 'value' is a method-appropriate arguments list
        if (this.gl && this.program) {
            this.uniforms[name] = this.uniforms[name] || {};
            let uniform = this.uniforms[name];
            let change = isDiff(uniform.value, value);
            if (change || this.change || uniform.location === undefined || uniform.value === undefined) {
                uniform.name = name;
                uniform.value = value;
                uniform.type = type;
                uniform.method = 'uniform' + method;
                uniform.location = this.gl.getUniformLocation(this.program, name);

                this.gl[uniform.method].apply(this.gl, [uniform.location].concat(uniform.value));
            }
        }
    }

    attribute(name) {
        if (!this.compiled) {
            return;
        }

        var attrib = (this.attribs[name] = this.attribs[name] || {});
        if (attrib.location != null) {
            return attrib;
        }

        attrib.name = name;
        attrib.location = this.gl.getAttribLocation(this.program, name);

        // var info = this.gl.getActiveAttrib(this.program, attrib.location);
        // attrib.type = info.type;
        // attrib.size = info.size;

        return attrib;
    }
}

// Static methods and state

Shader.id = 0;           // assign each program a unique id
Shader.programs = {};    // programs, by id
Shader.current = null;   // currently bound program

// Compile & link a WebGL program from provided vertex and fragment shader sources
// update a program if one is passed in. Create one if not. Alert and don't update anything if the shaders don't compile.
Shader.updateProgram = function (gl, program, vertex_shader_source, fragment_shader_source) {
    try {
        var vertex_shader = ShaderProgram.createShader(gl, vertex_shader_source, gl.VERTEX_SHADER);
        var fragment_shader = ShaderProgram.createShader(gl, fragment_shader_source, gl.FRAGMENT_SHADER);
    }
    catch(err) {
        log('error', err.message);
        throw err;
    }

    gl.useProgram(null);
    if (program != null) {
        var old_shaders = gl.getAttachedShaders(program);
        for(var i = 0; i < old_shaders.length; i++) {
            gl.detachShader(program, old_shaders[i]);
        }
    } else {
        program = gl.createProgram();
    }

    if (vertex_shader == null || fragment_shader == null) {
        return program;
    }

    gl.attachShader(program, vertex_shader);
    gl.attachShader(program, fragment_shader);

    gl.deleteShader(vertex_shader);
    gl.deleteShader(fragment_shader);

    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        let message = new Error(
            `WebGL program error:
            VALIDATE_STATUS: ${gl.getProgramParameter(program, gl.VALIDATE_STATUS)}
            ERROR: ${gl.getError()}
            --- Vertex Shader ---
            ${vertex_shader_source}
            --- Fragment Shader ---
            ${fragment_shader_source}`);

        let error = { type: 'program', message };
        console.log('error', error.message);
        throw error;
    }

    return program;
};

Shader.createShader = function (gl, source, type, errorCallback) {
    let shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        let type = (stype === gl.VERTEX_SHADER ? 'vertex' : 'fragment');
        let message = gl.getShaderInfoLog(shader);
        let errors = parseShaderErrors(message);
        throw { type, message, errors };
    }
    return shader;
}