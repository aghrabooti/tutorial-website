import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);


async function hashText(text:string){

  const data = new TextEncoder().encode(text);

  const hash = await crypto.subtle.digest(
    "SHA-256",
    data
  );

  return Array.from(new Uint8Array(hash))
    .map(b=>b.toString(16).padStart(2,"0"))
    .join("");

}



Deno.serve(async(req)=>{

try{


const {
 token,
 course_id
}=await req.json();



if(!token || !course_id){

return Response.json(
{
success:false,
error:"missing token or course_id"
},
{
status:400,
headers:corsHeaders
}
);

}



const tokenHash =
await hashText(token);



const {data:session,error:sessionError}
=
await supabaseAdmin
.from("user_sessions")
.select("*")
.eq("token_hash",tokenHash)
.eq("is_active",true)
.single();



if(sessionError || !session){

return Response.json(
{
success:false,
error:"invalid session"
},
{
status:401,
headers:corsHeaders
}
);

}




const {data:purchase,error}
=
await supabaseAdmin
.from("user_purchases")
.insert({

user_id:session.user_id,
course_id:course_id

})
.select()
.single();



if(error){

return Response.json(
{
success:false,
error:error.message
},
{
status:500,
headers:corsHeaders
}
);

}



return Response.json(
{
success:true,
purchase
},
{
status:200,
headers:corsHeaders
}
);



}
catch(error){

return Response.json(
{
success:false,
error:error.message
},
{
status:500,
headers:corsHeaders
}
);

}

});