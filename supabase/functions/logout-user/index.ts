import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── CORS: بدون این هدرها، مرورگر درخواست را از دامنه‌ی سایت رد می‌کند ──
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};



const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);



async function hashText(text:string){

  const encoder = new TextEncoder();

  const data = encoder.encode(text);


  const hashBuffer =
    await crypto.subtle.digest(
      "SHA-256",
      data
    );


  return Array.from(
    new Uint8Array(hashBuffer)
  )
  .map(
    b=>b.toString(16).padStart(2,"0")
  )
  .join("");

}





Deno.serve(async(req)=>{

// درخواست preflight مرورگر — باید ۲۰۰ با هدرهای CORS جواب بگیرد
if(req.method === "OPTIONS"){

return new Response("ok",{headers:corsHeaders});

}



try{


const {
 token
}=await req.json();



if(!token){

return new Response(
JSON.stringify({
error:"توکن ارسال نشده"
}),
{
status:400,
headers:{...corsHeaders,"Content-Type":"application/json"}
}
);

}



const tokenHash =
await hashText(token);




// پیدا کردن Session

const {data:session,error}=await supabaseAdmin
.from("user_sessions")
.select("id")
.eq("token_hash",tokenHash)
.eq("is_active",true)
.maybeSingle();





if(error || !session){

return new Response(
JSON.stringify({
error:"Session پیدا نشد"
}),
{
status:401,
headers:{...corsHeaders,"Content-Type":"application/json"}
}
);

}





// غیرفعال کردن Session

const {error:updateError}=await supabaseAdmin
.from("user_sessions")
.update({
is_active:false
})
.eq("id",session.id);





if(updateError){

return new Response(
JSON.stringify({
error:"خطا در خروج"
}),
{
status:500,
headers:{...corsHeaders,"Content-Type":"application/json"}
}
);

}





return new Response(
JSON.stringify({

success:true,

message:"با موفقیت خارج شدید"

}),
{
status:200,
headers:{...corsHeaders,"Content-Type":"application/json"}
}
);





}
catch(error){

return new Response(
JSON.stringify({
error:error.message
}),
{
status:500,
headers:{...corsHeaders,"Content-Type":"application/json"}
}
);

}


}); 