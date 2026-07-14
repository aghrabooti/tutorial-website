const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
  "authorization, x-client-info, apikey, content-type",
};


Deno.serve(async(req)=>{


if(req.method==="OPTIONS"){

return new Response(
"ok",
{
headers:corsHeaders
}
);

}


try{



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