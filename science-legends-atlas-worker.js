/* Whole-silhouette extraction stays off the input/rendering thread. */
importScripts('science-legends-atlas.js?v=1.458.0');
self.onmessage=function(event){
  var message=event.data,bitmap=message.bitmap;
  try{
    var pixels;
    if(bitmap){
      var canvas=new OffscreenCanvas(message.width,message.height),context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);
      pixels=context.getImageData(0,0,message.width,message.height).data;bitmap.close();bitmap=null;
    }else pixels=new Uint8ClampedArray(message.pixels);
    var unpacked=LegendsAtlas.extract(pixels,message.width,message.height,message.columns,4),transfer=[];
    var frames=unpacked.frames.map(function(rows){return rows.map(function(frame){
      if(!frame)return null;
      var rgba=LegendsAtlas.cropPixels(pixels,message.width,message.height,frame),cached=Object.assign({},frame,{rgba:rgba});
      delete cached.coverage;transfer.push(rgba.buffer);return cached;
    });});
    self.postMessage({id:message.id,frames:frames,missing:unpacked.missing},transfer);
  }catch(error){self.postMessage({id:message.id,error:String(error&&error.message||error)});}
  finally{if(bitmap)bitmap.close();}
};
