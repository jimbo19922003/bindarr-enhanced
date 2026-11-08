'use strict';
const english=value=>value==null||['en','eng','english'].includes(String(value).toLowerCase());
function selectCarddexImage(row,validate){
 const legacy=validate(row?.image_url);
 if(legacy)return legacy;
 if(!Array.isArray(row?.images))return null;
 const urls=new Set();
 for(const image of row.images){
  if(!image||typeof image!=='object'||!english(image.language)||!english(image.lang))continue;
  const url=validate(image.small_url);
  if(url)urls.add(url);
 }
 return urls.size===1?[...urls][0]:null;
}
module.exports={selectCarddexImage};
