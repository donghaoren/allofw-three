let THREE = require("./three");
module.exports = THREE;

let allofw = require("allofw");

require("./CCDIKSolver").init(THREE);
require("./FBXLoader2").init(THREE);
require("./MMDLoader").init(THREE);
require("./MMDPhysics").init(THREE);
require("./MTLLoader").init(THREE);
require("./OBJLoader").init(THREE);
require("./TGALoader").init(THREE);

THREE.TextureLoader = function (manager) {
    this.manager = (manager !== undefined) ? manager : DefaultLoadingManager;
}

THREE.createAllofwRenderer = (omni) => {
    let ThreeGL = THREE.GLWrapper(omni);
    ThreeGL.beforeThreeCode();
    var renderer = new THREE.WebGLRenderer({
        canvas: { width: 1000, height: 1000, addEventListener: () => null },
        context: ThreeGL,
        allofw: {
            omni: omni
        }
    });
    ThreeGL.afterThreeCode();
    renderer.beforeThreeCode = () => { ThreeGL.beforeThreeCode(); };
    renderer.afterThreeCode = () => { ThreeGL.afterThreeCode(); };
    return renderer;
};

Object.assign(THREE.TextureLoader.prototype, {
    load: function (url, onLoad, onProgress, onError) {
        var texture = new THREE.Texture();
        texture.isDataTexture = true;
        require("fs").readFile(url, (err, data) => {
            texture.format = THREE.RGBAFormat;
            texture.image = allofw.graphics.loadImageData(data);
            texture.image.width = texture.image.width();
            texture.image.height = texture.image.height();
            texture.image.complete = true;
            texture.image.data = texture.image.pixels();
            texture.needsUpdate = true;
            if (onLoad) onLoad(texture);
        });
        return texture;
    },

    setCrossOrigin: function (value) {
    },

    setPath: function (value) {
    }
});

// This function makes a copy of Allofw's GL object that is compatible with WebGL standard
THREE.GLWrapper = (omni) => {
    let GL = allofw.GL3;
    let r = {};
    let enums = {};
    let lastUsedProgram = 0;
    let vertexAttribsState = {};
    let texture2DBindings = {};
    let textureCubeBindings = {};
    let currentActiveTexture = GL.TEXTURE0;

    // Specialized functions:
    r.getShaderPrecisionFormat = (shaderType, precisionType) => {
        let buffer1 = new Int32Array(2);
        let buffer2 = new Int32Array(1);
        GL.getShaderPrecisionFormat(shaderType, precisionType, buffer1, buffer2);
        return {
            rangeMin: buffer1[0], rangeMax: buffer1[1],
            precision: buffer2[0]
        };
    };
    r.getParameter = (name) => {
        if (name == GL.MAX_TEXTURE_IMAGE_UNITS ||
            name == GL.MAX_VERTEX_TEXTURE_IMAGE_UNITS ||
            name == GL.MAX_TEXTURE_SIZE ||
            name == GL.MAX_CUBE_MAP_TEXTURE_SIZE ||
            name == GL.MAX_VERTEX_ATTRIBS ||
            name == GL.MAX_VERTEX_UNIFORM_VECTORS ||
            name == GL.MAX_VARYING_VECTORS ||
            name == GL.MAX_FRAGMENT_UNIFORM_VECTORS ||
            name == GL.MAX_VERTEX_ATTRIBS
        ) {
            let buffer = new Int32Array(1);
            GL.getIntegerv(name, buffer);
            return buffer[0];
        }
        if (name == GL.VERSION) {
            return "WebGL 1.0 (Allofw)";
        }
        // console.log("glGet:", enums[name]);
    };
    r.createShader = (type) => {
        let shader = GL.createShader(type);
        shader.type = type;
        return shader;
    };
    r.shaderSource = (shader, code) => {
        let prefix = "";
        code = code.replace("mat3 transpose(", "mat3 transpose_t(");
        code = code.replace(/texture2D/g, "texture");

        if (shader.type == GL.VERTEX_SHADER) {
            code = code.replace(/attribute/g, "in");
            code = code.replace(/varying/g, "out");
        } else {
            code = code.replace(/varying/g, "in");
            code = code.replace(/gl\_FragColor/g, "allofw_FragColor");
            prefix = "layout(location = 0) out vec4 allofw_FragColor;\n";
        }
        code = "#version 330\n" + prefix + "\n" + code.replace(/precision.*;/g, "");
        GL.shaderSource(shader, [code]);
    };
    r.getShaderParameter = (shader, name) => {
        let buffer = new Int32Array(1);
        GL.getShaderiv(shader, name, buffer);
        return buffer[0];
    };
    r.getProgramParameter = (program, name) => {
        let buffer = new Int32Array(1);
        GL.getProgramiv(program, name, buffer);
        return buffer[0];
    };
    r.getShaderInfoLog = (shader) => {
        var buffer = new Buffer(4);
        GL.getShaderiv(shader, GL.INFO_LOG_LENGTH, buffer);
        var length = buffer.readUInt32LE(0);
        if (length > 0) {
            var buf = new Buffer(length);
            GL.getShaderInfoLog(shader, length, buffer, buf);
            return buf.toString("utf-8");
        }
        return "";
    };
    r.getProgramInfoLog = (program) => {
        var buffer = new Buffer(4);
        GL.getProgramiv(program, GL.INFO_LOG_LENGTH, buffer);
        var length = buffer.readUInt32LE(0);
        if (length > 0) {
            var buf = new Buffer(length);
            GL.getProgramInfoLog(program, length, buffer, buf);
            return buf.toString("utf-8");
        }
        return "";
    };
    r.getActiveAttrib = (program, index) => {
        let buffer = new Buffer(256);
        let lengthArray = new Int32Array(2);
        let sizeArray = new Int32Array(1);
        let typeArray = new Int32Array(1);
        GL.getActiveAttrib(program, index, buffer.length, lengthArray, sizeArray, typeArray, buffer);
        let info = {
            name: buffer.slice(0, lengthArray[0]).toString("utf-8"),
            type: typeArray[0],
            size: sizeArray[0]
        }
        return info;
    };
    r.getActiveUniform = (program, index) => {
        let buffer = new Buffer(256);
        let lengthArray = new Int32Array(2);
        let sizeArray = new Int32Array(1);
        let typeArray = new Int32Array(1);
        GL.getActiveUniform(program, index, buffer.length, lengthArray, sizeArray, typeArray, buffer);
        let info = {
            name: buffer.slice(0, lengthArray[0]).toString("utf-8"),
            type: typeArray[0],
            size: sizeArray[0]
        }
        return info;
    };
    r.uniformMatrix4fv = (location, transpose, value) => {
        return GL.uniformMatrix4fv(location, 1, transpose, value);
    };
    r.uniformMatrix3fv = (location, transpose, value) => {
        return GL.uniformMatrix3fv(location, 1, transpose, value);
    };
    r.bufferData = (buffer, data, usage) => {
        return GL.bufferData(buffer, data.byteLength, data, usage);
    };
    r.deleteShader = (shader) => {
        shader.delete();
    };
    r.createTexture = () => {
        return new GL.Texture();
    };
    r.createBuffer = () => {
        return new GL.Buffer();
    };
    r.getExtension = () => true;
    r.useProgram = (program) => {
        if (program == null) program = 0;
        lastUsedProgram = program;
        GL.useProgram(program);
        if(program != 0) {
            omni.setUniforms(program.id());
        }
    };
    r.pixelStorei = (pname, param) => {
        if (pname == undefined) return;
        GL.pixelStorei(pname, param);
    };
    r.texImage2D = (...args) => {
        if (args.length == 9) {
            GL.texImage2D(...args);
        } else {
            // GL.texImage2D(target, level, internalformat, width, height, 0, format, type, pixels);
            console.log("texImage2D", ...args);
            console.log("ok", GL.getError());
        }
    };
    r.frontFace = (mode) => {
        // console.log("frontFace", mode == GL.CCW ? "CCW" : "CW");
        GL.frontFace(mode);
    };
    r.enable = (param) => {
        // console.log("glEnable:", enums[param]);
        GL.enable(param);
    };
    r.disable = (param) => {
        // console.log("glDisable:", enums[param]);
        GL.disable(param);
    };
    r.viewport = (x, y, w, h) => {
    };
    r.scissor = () => {
    };
    r.activeTexture = (unit) => {
        currentActiveTexture = unit;
        GL.activeTexture(unit);
    };
    r.bindTexture = (target, texture) => {
        if (texture == null) texture = 0;
        if (target == GL.TEXTURE_2D) {
            texture2DBindings[currentActiveTexture] = texture;
        }
        if (target == GL.TEXTURE_CUBE_MAP) {
            textureCubeBindings[currentActiveTexture] = texture;
        }
        GL.bindTexture(target, texture);
    };
    for (let key in GL) {
        if (r[key] == undefined) {
            if (GL.hasOwnProperty(key)) {
                r[key] = GL[key];
                if (typeof (GL[key]) == "number") {
                    enums[GL[key]] = key;
                    r[key] = GL[key];
                }
            }
        }

        (function (key) {
            if (typeof (r[key]) == "function") {
                let original = r[key];
                r[key] = (...args) => {
                    let r = original(...args);
                    let err = GL.getError();
                    if (err != 0) {
                        console.log(key, "(", ...args, ") =>", r, " Error:", err, enums[err]);
                        // console.log(args.map(x => enums[x] ? enums[x] : ""));
                    } else {
                        // console.log(key, "(", ...args, ") =>", r, " Error:", err, enums[err]);
                        // console.log(key);
                    }
                    return r;
                };
            }
        })(key);
    }

    let myVertexArray = new GL.VertexArray();

    r.beforeThreeCode = () => {
        GL.enable(GL.CULL_FACE);
        GL.bindVertexArray(myVertexArray);
        GL.useProgram(lastUsedProgram);
        if(lastUsedProgram != 0) {
            omni.setUniforms(lastUsedProgram.id());
        }
        for (let key in texture2DBindings) {
            GL.activeTexture(+key);
            GL.bindTexture(GL.TEXTURE_2D, texture2DBindings[key]);
        }
        for (let key in textureCubeBindings) {
            GL.activeTexture(+key);
            GL.bindTexture(GL.TEXTURE_CUBE_MAP, textureCubeBindings[key]);
        }
        GL.activeTexture(currentActiveTexture);
    };
    r.afterThreeCode = () => {
        // Unbind the program and vertex array
        GL.bindVertexArray(0);
        GL.useProgram(0);
        // Unbind textures
        for (let key in texture2DBindings) {
            GL.activeTexture(+key);
            GL.bindTexture(GL.TEXTURE_2D, 0);
        }
        for (let key in textureCubeBindings) {
            GL.activeTexture(+key);
            GL.bindTexture(GL.TEXTURE_CUBE_MAP, 0);
        }
        // Reset active texture
        GL.activeTexture(GL.TEXTURE0);

        // For omnistereo to work, we must disable CULL_FACE
        GL.disable(GL.CULL_FACE);
    }
    return r;
}