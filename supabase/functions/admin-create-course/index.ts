import { createClient } from "https://esm.sh/@supabase/supabase-js@2";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
};



function jsonResponse(
  data:any,
  status=200
){

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers:{
        ...corsHeaders,
        "Content-Type":"application/json"
      }
    }
  );

}



const supabaseAdmin =
createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);



async function sha256(text:string){

  const hash =
  await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );


  return Array.from(
    new Uint8Array(hash)
  )
  .map(
    b=>b.toString(16).padStart(2,"0")
  )
  .join("");

}



Deno.serve(async(req)=>{


if(req.method==="OPTIONS"){

return new Response(null,{
status:204,
headers:corsHeaders
});

}



try{


const {

token,
title,
grade,
category,
type,
description,
price,
discount_price,
image_url,
major

}=await req.json();



if(!token){

return jsonResponse({
success:false,
error:"توکن ارسال نشده"
},400);

}



if(!title || !type){

return jsonResponse({
success:false,
error:"عنوان و نوع محتوا الزامی است"
},400);

}



// بررسی سشن

const tokenHash =
await sha256(token);



const {data:session}=

await supabaseAdmin
.from("user_sessions")
.select(
"user_id,is_active,expires_at"
)
.eq(
"token_hash",
tokenHash
)
.maybeSingle();



if(
!session ||
!session.is_active ||
new Date(session.expires_at)<new Date()
){

return jsonResponse({
success:false,
error:"جلسه معتبر نیست"
},401);

}



// بررسی ادمین

const {data:user}=

await supabaseAdmin
.from("site_users")
.select("role")
.eq(
"id",
session.user_id
)
.single();



if(
!user ||
user.role!=="admin"
){

return jsonResponse({
success:false,
error:"دسترسی غیرمجاز"
},403);

}



// ساخت محتوا


const {data:course,error}=

await supabaseAdmin
.from("courses")
.insert({

title,

grade:grade || null,

category:category || null,

type,

description:description || null,

price:
price
?
Number(price)
:
null,

discount_price:
discount_price
?
Number(discount_price)
:
null,

image_url:
image_url || null,

major:
major || null

})
.select()
.single();



if(error){

console.error(error);

return jsonResponse({
success:false,
error:error.message
},500);

}



return jsonResponse({

success:true,

course,

message:"محتوا ساخته شد"

});



}
catch(error){


console.error(error);


return jsonResponse({

success:false,

error:
error instanceof Error
?
error.message
:
"خطای داخلی"

},500);



}



});