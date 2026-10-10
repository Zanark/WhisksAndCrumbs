export function createCreamShaders({ MAX_PRIMITIVES, TRAIL_PROFILE, CREAM_PROFILE }) {
const vertex = `#version 300 es
in vec2 position;
void main(){gl_Position=vec4(position,0.,1.);}
`;
const fragment = `#version 300 es
precision highp float;
uniform vec2 resolution;
uniform float pixelRatio;
uniform vec2 viewSize;
uniform int scoopCount;
uniform vec4 scoops[${MAX_PRIMITIVES}];
uniform vec4 trail[${TRAIL_PROFILE.links}];
uniform int trailCount;
uniform float headRadius;
uniform float cursorTint;
uniform vec4 cursorShape;
out vec4 color;

float merge(float a,float b,float k){
  float h=max(k-abs(a-b),0.)/k;
  return min(a,b)-h*h*k*.25;
}
vec2 tailSurface(vec2 p){
  vec2 nearest=vec2(100000.,0.);
  for(int i=0;i<${TRAIL_PROFILE.links};i++){
    if(i>=trailCount)break;
    vec2 a=trail[i].xy,b=trail[i].zw,axis=b-a;
    float lengthSquared=dot(axis,axis);
    if(lengthSquared<.25)continue;
    float t=clamp(dot(p-a,axis)/lengthSquared,0.,1.);
    float progress=(float(i)+t)/${TRAIL_PROFILE.links.toFixed(1)};
    float radius=headRadius*mix(${TRAIL_PROFILE.startRadius.toFixed(3)},${TRAIL_PROFILE.endRadius.toFixed(3)},progress);
    float distance=length(p-mix(a,b,t))-radius;
    if(distance<nearest.x)nearest=vec2(distance,radius);
  }
  return nearest;
}
vec2 cursorWarp(vec2 delta,float radius){
  float c=cos(cursorShape.x),s=sin(cursorShape.x);
  vec2 q=vec2(c*delta.x+s*delta.y,-s*delta.x+c*delta.y);
  q*=vec2(1./cursorShape.y,cursorShape.y);
  if(dot(q,q)<.000001)return q;
  float theta=atan(q.y,q.x),phase=cursorShape.z,energy=cursorShape.w;
  float wave=(sin(2.*theta+phase)*(.035+.012*energy)+
    cos(3.*theta-2.*phase)*(.024+.008*energy))*smoothstep(0.,radius*.4,length(q));
  return q/(1.+wave);
}
float surface(vec2 p){
  float d=100000.;
  float blend=min(viewSize.x,viewSize.y)*.040;
  for(int i=0;i<${MAX_PRIMITIVES};i++){
    if(i>=scoopCount)break;
    vec4 s=scoops[i];
    if(cursorTint>.5&&i==scoopCount-1)d=merge(d,length(cursorWarp(p-s.xy,s.z))-s.z,blend);
    else d=merge(d,length(p-s.xy)-s.z,blend);
  }
  return merge(d,tailSurface(p).x,min(blend*.4,headRadius*.4));
}
float creamHeight(vec2 p,float distance,float scale){
  float totalWeight=0.;
  float totalHeight=0.;
  for(int i=0;i<${MAX_PRIMITIVES};i++){
    if(i>=scoopCount)break;
    vec4 s=scoops[i];
    vec2 q=(p-s.xy)/s.z;
    if(cursorTint>.5&&i==scoopCount-1)q=cursorWarp(p-s.xy,s.z)/s.z;
    float q2=dot(q,q);
    if(q2>9.)continue;
    float weight=exp(-q2*${CREAM_PROFILE.weightFalloff.toFixed(3)});
    float dome=s.z*${CREAM_PROFILE.domeHeight.toFixed(3)}*exp(-q2*${CREAM_PROFILE.domeFalloff.toFixed(3)});
    float crown=0.;
    if(s.w>0.){
      float angle=float(i)*2.399963+.35;
      vec2 tip=s.xy+vec2(cos(angle)*.12,sin(angle)*.10)*s.z;
      vec2 peak=(p-tip)/(s.z*${CREAM_PROFILE.peakWidth.toFixed(3)});
      crown=exp(-${CREAM_PROFILE.peakFalloff.toFixed(3)}*(sqrt(dot(peak,peak)+${(CREAM_PROFILE.peakRoundness ** 2).toFixed(6)})-${CREAM_PROFILE.peakRoundness.toFixed(3)}));
    }
    totalHeight+=weight*(dome+s.z*${CREAM_PROFILE.peakHeight.toFixed(3)}*s.w*crown);
    totalWeight+=weight;
  }
  vec2 tail=tailSurface(p);
  if(tail.y>0.){
    float q=max(0.,tail.x+tail.y)/tail.y;
    float weight=exp(-q*q*${CREAM_PROFILE.weightFalloff.toFixed(3)});
    totalHeight+=weight*tail.y*.5*exp(-q*q*${CREAM_PROFILE.domeFalloff.toFixed(3)});
    totalWeight+=weight;
  }
  float rim=1.-exp(-max(-distance,0.)/(scale*${CREAM_PROFILE.rimWidth.toFixed(3)}));
  return rim*totalHeight/max(totalWeight,.00001);
}
void main(){
  vec2 p=vec2(gl_FragCoord.x,resolution.y-gl_FragCoord.y)/pixelRatio;
  float scale=min(viewSize.x,viewSize.y);
  float d=surface(p);
  float aa=max(fwidth(d),.55);
  float coverage=1.-smoothstep(-aa,aa,d);
  float shadowDistance=surface(p-vec2(6.,11.));
  float shadow=(1.-smoothstep(-5.,scale*.034,shadowDistance))*(1.-coverage)*.10;
  float height=creamHeight(p,d,scale);
  vec3 normal=normalize(vec3(-dFdx(height)*pixelRatio,dFdy(height)*pixelRatio,1.));
  vec3 light=normalize(vec3(-.55,-.78,.72));
  float diffuse=max(0.,dot(normal,light));
  vec3 halfway=normalize(light+vec3(0.,0.,1.));
  float gloss=pow(max(0.,dot(normal,halfway)),48.);
  float broad=pow(max(0.,dot(normal,halfway)),8.);
  vec3 ivory=vec3(255.,250.,238.)/255.;
  if(cursorTint>.5){
    float follower=d;
    float strawberry=1.-smoothstep(-aa,aa,follower);
    ivory=mix(ivory,vec3(255.,224.,234.)/255.,strawberry);
  }
  vec3 cream=ivory*(.86+.14*diffuse);
  cream+=vec3(1.,.995,.97)*(.18*gloss+.035*broad);
  float grain=fract(sin(dot(floor(p*pixelRatio),vec2(12.9898,78.233)))*43758.5453);
  cream+=(grain-.5)*.003;
  // Associated alpha lets the patterned ground show only outside cream and through its shadow.
  float alpha=1.-(1.-shadow)*(1.-coverage);
  color=vec4(clamp(cream,0.,1.)*coverage,alpha);
}
`;
  // Keep the classic fragment byte-identical: even inactive tint branches can change GPU rounding.
  const strawberryField = `float strawberryWeight(vec2 p,float aa){
  float ivoryDistance=100000.,pinkDistance=100000.;
  float blend=min(viewSize.x,viewSize.y)*.040;
  for(int i=0;i<${MAX_PRIMITIVES};i++){
    if(i>=scoopCount)break;
    float distance=length(p-scoops[i].xy)-scoops[i].z;
    if(i<strawberryStart)ivoryDistance=merge(ivoryDistance,distance,blend);
    else pinkDistance=merge(pinkDistance,distance,blend);
  }
  // A newly placed strawberry stays pink even inside a larger ivory group.
  return max(1.-smoothstep(-aa,aa,pinkDistance),smoothstep(-blend,blend,ivoryDistance-pinkDistance));
}
`;
  const strawberryFragment = fragment
    .replace('uniform vec4 cursorShape;', 'uniform vec4 cursorShape;\nuniform int strawberryStart;')
    .replace('float surface(vec2 p){', `${strawberryField}float surface(vec2 p){`)
    .replace('  vec3 cream=ivory*', `  if(strawberryStart>=0){
    ivory=mix(ivory,vec3(255.,224.,234.)/255.,strawberryWeight(p,aa));
  }
  vec3 cream=ivory*`);
  const contactFields = `vec4 contactSurfaces(vec2 p){
  float background=100000.,head=100000.,ivoryDistance=100000.,pinkDistance=100000.;
  float blend=min(viewSize.x,viewSize.y)*.040;
  for(int i=0;i<${MAX_PRIMITIVES};i++){
    if(i>=scoopCount)break;
    vec4 s=scoops[i];
    if(i<ambientCount){
      float distance=length(p-s.xy)-s.z;
      background=merge(background,distance,blend);
      if(strawberryStart>=0){
        if(i<strawberryStart)ivoryDistance=merge(ivoryDistance,distance,blend);
        else pinkDistance=merge(pinkDistance,distance,blend);
      }
    }else{
      head=length((cursorTint>.5||contactActive>0)?cursorWarp(p-s.xy,s.z):p-s.xy)-s.z;
    }
  }
  float shared=merge(background,head,blend);
  shared=merge(shared,tailSurface(p).x,min(blend*.4,headRadius*.4));
  return vec4(shared,background,ivoryDistance,pinkDistance);
}
float cursorSurface(vec2 p){
  vec4 head=scoops[scoopCount-1];
  float d=length(cursorWarp(p-head.xy,head.z))-head.z;
  return merge(d,tailSurface(p).x,min(min(viewSize.x,viewSize.y)*.016,headRadius*.4));
}
`;
  const originalSurface = fragment.slice(fragment.indexOf('float surface(vec2 p){'), fragment.indexOf('float creamHeight('));
  const contactFragment = fragment
    .replace(originalSurface, contactFields)
    .replace('uniform vec4 cursorShape;', `uniform vec4 cursorShape;
uniform int strawberryStart;
uniform int ambientCount;
uniform int contactActive;
uniform int contactPass;
uniform int contactTrailCount;
uniform vec4 contactShape;`)
    .replace('if(i>=trailCount)break;', 'if(i>=(contactActive>0?contactTrailCount:trailCount))break;')
    .replace('  float c=cos(cursorShape.x),s=sin(cursorShape.x);', `  vec4 shape=contactActive>0?contactShape:cursorShape;
  float c=cos(shape.x),s=sin(shape.x);`)
    .replaceAll('cursorShape.y', 'shape.y')
    .replaceAll('cursorShape.z', 'shape.z')
    .replaceAll('cursorShape.w', 'shape.w')
    .replaceAll('cursorTint>.5&&i==scoopCount-1', '(cursorTint>.5||contactActive>0)&&i==scoopCount-1')
    .replace('  float d=surface(p);', '  vec4 fields=contactSurfaces(p);\n  float d=fields.x;')
    .replace('  float shadowDistance=surface(p-vec2(6.,11.));',
      '  vec4 shadowFields=contactSurfaces(p-vec2(6.,11.));\n  float shadowDistance=shadowFields.x;')
    .replace(`  if(cursorTint>.5){
    float follower=d;
    float strawberry=1.-smoothstep(-aa,aa,follower);
    ivory=mix(ivory,vec3(255.,224.,234.)/255.,strawberry);
  }`, `  float background=fields.y,own=cursorSurface(p),blend=scale*.040;
  float softCursor=1.-smoothstep(-headRadius*.65,0.,own);
  float strawberry=max(softCursor,smoothstep(-blend,blend,background-own));
  if(strawberryStart>=0)strawberry=max(strawberry,max(1.-smoothstep(-aa,aa,fields.w),smoothstep(-blend,blend,fields.z-fields.w)));
  if(cursorTint>.5||contactActive>0)ivory=mix(ivory,vec3(255.,224.,234.)/255.,strawberry);`)
    .replace('  float alpha=1.-(1.-shadow)*(1.-coverage);', `  if(contactActive>0){
    float baseAA=max(fwidth(background),.55);
    float baseCoverage=1.-smoothstep(-baseAA,baseAA,background);
    float baseShadow=(1.-smoothstep(-5.,scale*.034,shadowFields.y))*(1.-baseCoverage)*.10;
    if(contactPass==1){
      float added=clamp((coverage-baseCoverage)/max(1.-baseCoverage,.00001),0.,1.);
      float neck=clamp((background-d)/max(aa,.5),0.,1.)*(1.-smoothstep(0.,blend,-background));
      float addedShadow=clamp((shadow-baseShadow)/max(1.-baseShadow,.00001),0.,1.);
      coverage=max(added,baseCoverage*max(softCursor,neck));
      shadow=addedShadow;
    }else{
      coverage=baseCoverage;
      shadow=baseShadow;
    }
  }
  float alpha=1.-(1.-shadow)*(1.-coverage);`);
  return { vertex, fragment, strawberryFragment, contactFragment };
}
