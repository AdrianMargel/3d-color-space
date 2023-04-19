
class Color{
	constructor(rOrC=0,g=0,b=0,a=1){
		if(typeof rOrC=="object"){
			this.r=rOrC.r;
			this.g=rOrC.g;
			this.b=rOrC.b;
			this.a=rOrC.a;
		}else if(isHex(rOrC)){
			let c=hexToRgb(rOrC);
			this.r=c.r/255;
			this.g=c.g/255;
			this.b=c.b/255;
			this.a=1;
		}else{
			this.r=rOrC;
			this.g=g;
			this.b=b;
			this.a=a;
		}
		this.limit();
	}
	limit(){
		function lim(c){
			return Math.max(Math.min(c,1),0);
		}
		this.r=lim(this.r);
		this.g=lim(this.g);
		this.b=lim(this.b);
		this.a=lim(this.a);
	}
	get R(){
		return Math.floor(this.r*255);
	}
	set R(v){
		this.r=v/255;
	}
	get G(){
		return Math.floor(this.g*255);
	}
	set G(v){
		this.g=v/255;
	}
	get B(){
		return Math.floor(this.b*255);
	}
	set B(v){
		this.b=v/255;
	}
	toString(){
		return rgbToHex(this.r*255,this.g*255,this.b*255,this.a*255);
	}
}

class Octree{
	constructor(size){
		this.size=size;
		this.children=Array(8).fill(null);
	}
	set(valOrF,x,y,z){
		let x1=Math.floor(x/this.size);
		let y1=Math.floor(y/this.size);
		let z1=Math.floor(z/this.size);

		let idx=x1+y1*2+z1*4;
		let next=this.children[idx];

		if(this.size==1){
			if(typeof valOrF=="function"){
				this.children[idx]=valOrF(next);
			}else{
				this.children[idx]=valOrF;
			}
			return;
		}

		if(next==null){
			next=new Octree(this.size/2);
			this.children[idx]=next;
		}

		let x2=x%this.size;
		let y2=y%this.size;
		let z2=z%this.size;
		return next.set(valOrF,x2,y2,z2);
	}
	get(x,y,z){
		let x1=Math.floor(x/this.size);
		let y1=Math.floor(y/this.size);
		let z1=Math.floor(z/this.size);

		let idx=x1+y1*2+z1*4;
		let next=this.children[idx];

		if(next==null)
			return this;
		if(this.size==1)
			return next;

		let x2=x%this.size;
		let y2=y%this.size;
		let z2=z%this.size;
		return next.get(x2,y2,z2);
	}
	toArray(arr=[]){
		this.index=arr.length;
		arr.push(...this.children);
		if(this.size>1){
			this.children.forEach(c=>{
				if(c!=null){
					c.toArray(arr);
				}
			});

			this.children.forEach((c,i)=>{
				if(c!=null){
					arr[this.index+i]=c.index;
				}
			});
		}
		return arr;
	}
	toUintArray(){
		return this.toArray().map(x=>(x??0));
		// return Array(600000).fill().map((x,i)=>(i%2)*500);
	}
}

function colorOct(colors){
	let oct=new Octree(2**(8-1));
	colors.forEach((col)=>{
		oct.set((val)=>(val??0)+1,col.R,col.G,col.B);
	});
	return oct;
}

function glsl(strings,...keys){
	return strings[0]+keys.map((k,i)=>k+strings[i+1]).join("");
}

let vs=glsl`#version 300 es
in vec4 position;

void main() {
	gl_Position = position;
}
`;
let fs=glsl`#version 300 es
precision highp float;

uniform vec2 resolution;
uniform vec2 octResolution;
uniform float time;
uniform highp usampler2D octree;
uniform float transparency;

uniform vec3 position;
uniform vec3 xRot;
uniform vec3 yRot;
uniform vec3 zRot;

out vec4 outColor;

highp uint getAtIdx(highp uint idx){
	uint width=uint(octResolution.x);
	vec2 halfPix=vec2(0.5,0.5);

	uint y=idx/width;
	uint x=idx-(y*width);

	vec2 idxPos=vec2(x,y);
	//make sure to sample from the center of the pixel
	idxPos+=halfPix;
	if(idxPos.y>=octResolution.y){
		return uint(0);
	}
	return texture(octree, idxPos/octResolution).r;
}

vec2 getAtPos(float x,float y,float z){
	float size=256.;

	if(x>=size||y>=size||z>=size||x<0.||y<0.||z<0.){
		return vec2(size,0.);
	}

	float x1;
	float y1;
	float z1;
	float x2=x;
	float y2=y;
	float z2=z;
	highp uint next=uint(0);

	for(int i=0;i<8;i++){
		size/=2.0;

		x1=floor(x2/size);
		y1=floor(y2/size);
		z1=floor(z2/size);
		
		next=getAtIdx(next+uint(x1+y1*2.+z1*4.));
		if(next==uint(0)||size==1.){
			return vec2(size,float(next));
		}

		x2=floor(mod(x2,size));
		y2=floor(mod(y2,size));
		z2=floor(mod(z2,size));
	}

	//should never be reached
	return vec2(0.,0.);
}
 
vec3 rayTrace(vec2 coord){
	float ratio=resolution.x/resolution.y;
	vec3 pos=position;
	vec3 dir=vec3((coord.x*xRot*ratio)+(coord.y*yRot)+(1.0*zRot));
	dir*=1./length(dir);

	vec2 cube=getAtPos(floor(pos.x),floor(pos.y),floor(pos.z));
	float size=cube.x;

	vec3 col=vec3(0.,0.,0.);
	vec3 nextCol=vec3(0.,0.,0.);
	float remaining=1.;
	float nextWeight=0.;

	for(int i=0;i<1000;i++){
		float next=1000.;
		float nextTry;
		vec3 moveDim=vec3(0.,0.,0.);
		vec3 modPos=vec3(
			size-mod(pos.x*sign(dir.x),size),
			size-mod(pos.y*sign(dir.y),size),
			size-mod(pos.z*sign(dir.z),size)
		);
		if(modPos.x>0.){
			nextTry=abs(modPos.x/dir.x);
			if(nextTry<next){
				moveDim=vec3(dir.x,0.,0.);
				next=nextTry;
			}
		}
		if(modPos.y>0.){
			nextTry=abs(modPos.y/dir.y);
			if(nextTry<next){
				moveDim=vec3(0.,dir.y,0.);
				next=nextTry;
			}
		}
		if(modPos.z>0.){
			nextTry=abs(modPos.z/dir.z);
			if(nextTry<next){
				moveDim=vec3(0.,0.,dir.z);
				next=nextTry;
			}
		}
		if(cube.y>0.){
			nextWeight*=next;

			float opacity=1.-pow(transparency,nextWeight);

			col+=nextCol*remaining*opacity;

			remaining*=1.-opacity;

			if(remaining<0.01){
				return col;
			}

			nextWeight=0.;
		}
		pos+=dir*next;

		if(moveDim.x!=0.){
			pos.x=round(pos.x);
		}else if(moveDim.y!=0.){
			pos.y=round(pos.y);
		}else if(moveDim.z!=0.){
			pos.z=round(pos.z);
		}

		if(
			(dir.x>0.&&pos.x>=256.)
			||(dir.x<0.&&pos.x<=0.)
			||(dir.y>0.&&pos.y>=256.)
			||(dir.y<0.&&pos.y<=0.)
			||(dir.z>0.&&pos.z>=256.)
			||(dir.z<0.&&pos.z<=0.)
		){
			float margin=4.0;
			float margin2=256.-margin;
			if(
				(
					  (pos.x>=0.&&pos.x<=256.)
					&&(pos.y>=0.&&pos.y<=256.)
					&&(pos.z>=0.&&pos.z<=256.)
				)
				&&
				(
					  (pos.x<margin&&pos.y<margin)
					||(pos.x>margin2&&pos.y>margin2)
					||(pos.x<margin&&pos.y>margin2)
					||(pos.x>margin2&&pos.y<margin)
					||
					  (pos.z<margin&&pos.y<margin)
					||(pos.z>margin2&&pos.y>margin2)
					||(pos.z<margin&&pos.y>margin2)
					||(pos.z>margin2&&pos.y<margin)
					||
					  (pos.x<margin&&pos.z<margin)
					||(pos.x>margin2&&pos.z>margin2)
					||(pos.x<margin&&pos.z>margin2)
					||(pos.x>margin2&&pos.z<margin)
				)
			){
				float lineDiff;
				if((pos.x<=0.||pos.x>=256.)){
					lineDiff=max(
						max(256.-pos.z,pos.z),
						max(256.-pos.y,pos.y)
					);
				}else if((pos.y<=0.||pos.y>=256.)){
					lineDiff=max(
						max(256.-pos.x,pos.x),
						max(256.-pos.z,pos.z)
					);
				}else if((pos.z<=0.||pos.z>=256.)){
					lineDiff=max(
						max(256.-pos.x,pos.x),
						max(256.-pos.y,pos.y)
					);
				}
				lineDiff=(lineDiff-256.+margin)/margin;
				return col+vec3(lineDiff,lineDiff,lineDiff)*remaining;
			}
			// return col+vec3(float(i)/50.,float(i)/50.,float(i)/50.)*remaining;
			return col;
		}

		vec3 toTest=pos+moveDim;
		toTest=floor(toTest);
		cube=getAtPos(toTest.x,toTest.y,toTest.z);
		size=cube.x;
		if(cube.y>0.){
			nextCol=toTest/255.;
			nextWeight=cube.y;
		}
	}

	return col;
}

void main(){
	vec2 coord = gl_FragCoord.xy;
	vec2 uv = gl_FragCoord.xy / resolution;
	vec2 uv2=vec2(uv.x*2.-1.,uv.y*2.-1.);

	// highp uint idx=uint(coord.x)+(uint(coord.y)*uint(resolution.x));
	// vec2 value=getAtPos(coord.x,coord.y,255.);

	outColor = vec4(rayTrace(uv2),1);
}
`;

const gl = document.getElementById("c").getContext("webgl2");
const programInfo = twgl.createProgramInfo(gl, [vs, fs]);

let control=new Control();
control.connect(document.getElementById("c"));

let pixelCount=10000;
let octree=colorOct(Array(pixelCount).fill().map(x=>
	new Color(Math.random()*256/255,Math.random()*256/255,Math.random()*256/255)
));

// let octree=new Octree(2**7);
// for(let x=0;x<256;x+=1){
// 	for(let y=0;y<256;y+=1){
// 		for(let z=0;z<256;z+=1){
// 			octree.set((val)=>(val??0)+1,x,y,z);
// 		}
// 	}
// };

// let octree=colorOct(Array(10000).fill().map(x=>
// 	new Color(0,0,0)
// ));
let octreeArr=octree.toUintArray();
let octreeWidth=Math.ceil(Math.sqrt(octreeArr.length));
let octreeHeight=Math.ceil(octreeArr.length/octreeWidth);
let requiredLength=octreeWidth*octreeHeight;
for(let i=octreeArr.length;i<requiredLength;i++){
	octreeArr.push(0);
}

const arrays = {
	position: {
		numComponents: 2,
		data:[
			-1, 1,
			1, -1,
			1, 1,
			-1, 1,
			1, -1,
			-1, -1,
		]
	},
};
const bufferInfo = twgl.createBufferInfoFromArrays(gl, arrays);

let textures = twgl.createTextures(gl, {
	octree: {
		src: new Uint32Array(octreeArr),
		width: octreeWidth,
		height: octreeHeight,
		minMag: gl.NEAREST,
		internalFormat: gl.R32UI,
	},
});

let position=[
	-10+Math.random()*0.0001,
	255+10+Math.random()*0.0001,
	-10+Math.random()*0.0001
];
let velocity=[
	0,
	0,
	0
];
let angle1=-PI/5;
let angle2=0;
let opacity=0;
let opacityBase=0;
calcOpacity();

function matrixMultiply(point,rotMatrix){
	let result=[];
	for(let i=0;i<3;i++){
		result.push(
			point[0]*rotMatrix[i][0]
			+point[1]*rotMatrix[i][1]
			+point[2]*rotMatrix[i][2]
		);
	}
	return result;
}
function vecAdd(a,b){
	let result=[];
	for(let i=0;i<a.length;i++){
		result.push(a[i]+b[i]);
	}
	return result;
}
function vecScl(a,s){
	let result=[];
	for(let i=0;i<a.length;i++){
		result.push(a[i]*s);
	}
	return result;
}
function rotateX(point,rot){
	let rotMatrix=[
		[1,0,0],
		[0,Math.cos(rot),-Math.sin(rot)],
		[0,Math.sin(rot),Math.cos(rot)]
	];
	return matrixMultiply(point,rotMatrix);
}
function rotateY(point,rot){
	let rotMatrix=[
		[Math.cos(rot),0,Math.sin(rot)],
		[0,1,0],
		[-Math.sin(rot),0,Math.cos(rot)]
	];
	return matrixMultiply(point,rotMatrix);
}
function rotateZ(point,rot){
	let rotMatrix=[
		[Math.cos(rot),-Math.sin(rot),0],
		[Math.sin(rot),Math.cos(rot),0],
		[0,0,1]
	];
	return matrixMultiply(point,rotMatrix);
}

function render(time) {
	twgl.resizeCanvasToDisplaySize(gl.canvas);
	gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

	let xRot=[1,0,0];
	let yRot=[0,1,0];
	let zRot=[0,0,1];

	xRot=rotateX(xRot,angle1);
	yRot=rotateX(yRot,angle1);
	zRot=rotateX(zRot,angle1);

	xRot=rotateY(xRot,angle2);
	yRot=rotateY(yRot,angle2);
	zRot=rotateY(zRot,angle2);

	const uniforms = {
		transparency: 
			Math.max(Math.min(1-(opacity*(Math.min(100000.0/pixelCount,1))),1),0),
		time: time * 0.001,
		resolution: [gl.canvas.width,gl.canvas.height],
		octResolution: [octreeWidth,octreeHeight],
		octree: textures.octree,
		xRot,
		yRot,
		zRot,
		position
	};

	gl.useProgram(programInfo.program);
	twgl.setBuffersAndAttributes(gl, programInfo, bufferInfo);
	twgl.setUniforms(programInfo, uniforms);
	twgl.drawBufferInfo(gl, bufferInfo);

	requestAnimationFrame(render);
}
requestAnimationFrame(render);

document.getElementById("c").onclick = function() {
	document.getElementById("c").requestPointerLock();
}

let speed=0.2*3;
let turnSpeed=0.003;
let friction=0.8;
let opacitySpeed=0.5;

setInterval(run,1000/60);
function run(){
	let mDiff=control.getMouseMove();

	angle1=Math.min(Math.max(mDiff.y*turnSpeed+angle1,-PI/2),PI/2);
	angle2+=mDiff.x*turnSpeed;

	let xRot=[1,0,0];
	let yRot=[0,1,0];
	let zRot=[0,0,1];

	xRot=rotateX(xRot,angle1);
	yRot=rotateX(yRot,angle1);
	zRot=rotateX(zRot,angle1);

	xRot=rotateY(xRot,angle2);
	yRot=rotateY(yRot,angle2);
	zRot=rotateY(zRot,angle2);

	if(control.isKeyDown("A")){
		velocity=vecAdd(velocity,vecScl(xRot,-speed));
	}
	if(control.isKeyDown("D")){
		velocity=vecAdd(velocity,vecScl(xRot,speed));
	}
	if(control.isKeyDown("W")){
		velocity=vecAdd(velocity,vecScl(zRot,speed));
	}
	if(control.isKeyDown("S")){
		velocity=vecAdd(velocity,vecScl(zRot,-speed));
	}
	if(control.isKeyDown(" ")){
		velocity=vecAdd(velocity,vecScl(yRot,speed));
	}
	if(control.isKeyCodeDown(16)){
		velocity=vecAdd(velocity,vecScl(yRot,-speed));
	}
	position=vecAdd(position,velocity);
	velocity=vecScl(velocity,friction);

	opacityBase=opacityBase+Math.min(Math.max(control.mouseWheel,-1),1)*opacitySpeed;
	calcOpacity();
	
	control.prime();
}
function calcOpacity(){
	opacity=1/Math.pow(2,opacityBase);
}

window.addEventListener('load', function() {
	document.getElementById("uploader").addEventListener('change', function() {
		var c = document.getElementById("uploaded");
		var ctx = c.getContext("2d");
		if (this.files && this.files[0]) {
			var img = new Image();
			img.src = URL.createObjectURL(this.files[0]);
			img.onload=()=>{
				let w=img.width;
				let h=img.height;
				c.width=w;
				c.height=h;
				ctx.drawImage(img, 0, 0);
				displayImage(ctx,w,h);
			};
		}
	});
	document.getElementById("toggle").onclick=()=>toggleUploader();
});
let uploaderToggled=true;
function toggleUploader(){
	uploaderToggled=!uploaderToggled;
	if(uploaderToggled){
		document.querySelector(".control").style="";
	}else{
		document.querySelector(".control").style="display:none";
	}
}
function displayImage(ctx,w,h){
	let colorData=ctx.getImageData(0, 0, w, h);
	octree=new Octree(2**(8-1))
	function addColor(r,g,b){
		let col=RGBtoHSV(r,g,b);
		// let hue=col.h;
		// let sat=col.s;
		// let val=col.v;
		// let rot2d=new Vector(hue*TAU,sat,true);
		// let pos=[
		// 	Math.floor((rot2d.x+1)/2*255),
		// 	Math.floor(val*255),
		// 	Math.floor((rot2d.y+1)/2*255)
		// ];
		// octree.set((val)=>(val??0)+1,...pos);

		octree.set((val)=>(val??0)+1,r,g,b);
	}
	function addPixelColor(x,y){
		let index=((x%colorData.width)+(y*colorData.width))*4;
		let data=colorData.data;
		if(index>=0&&index+3<data.length){
			addColor(data[index],data[index+1],data[index+2]);
		}
	}
	for(let x=0;x<colorData.width;x++){
		for(let y=0;y<colorData.height;y++){
			addPixelColor(x,y);
		}
	}
	pixelCount=colorData.width*colorData.height;

	octreeArr=octree.toUintArray();
	octreeWidth=Math.ceil(Math.sqrt(octreeArr.length));
	octreeHeight=Math.ceil(octreeArr.length/octreeWidth);
	requiredLength=octreeWidth*octreeHeight;
	for(let i=octreeArr.length;i<requiredLength;i++){
		octreeArr.push(0);
	}
	textures = twgl.createTextures(gl, {
		octree: {
			src: new Uint32Array(octreeArr),
			width: octreeWidth,
			height: octreeHeight,
			minMag: gl.NEAREST,
			internalFormat: gl.R32UI,
		},
	});
}