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



async function hashText(text: string) {

  const data =
    new TextEncoder().encode(text);


  const hash =
    await crypto.subtle.digest(
      "SHA-256",
      data
    );


  return Array.from(
    new Uint8Array(hash)
  )
  .map(
    (b)=>b.toString(16).padStart(2,"0")
  )
  .join("");

}




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


    const {
      token,
      cart_item_id
    } = await req.json();



    if(!token || !cart_item_id){

      return Response.json(
        {
          success:false,
          error:"token or cart_item_id missing"
        },
        {
          status:400,
          headers:corsHeaders
        }
      );

    }




    const tokenHash =
    await hashText(token);




    const {
      data:session,
      error:sessionError
    } =
    await supabaseAdmin
    .from("user_sessions")
    .select("*")
    .eq(
      "token_hash",
      tokenHash
    )
    .eq(
      "is_active",
      true
    )
    .maybeSingle();




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




    if(
      new Date(session.expires_at)
      <
      new Date()
    ){


      await supabaseAdmin
      .from("user_sessions")
      .update({
        is_active:false
      })
      .eq(
        "id",
        session.id
      );


      return Response.json(
        {
          success:false,
          error:"session expired"
        },
        {
          status:401,
          headers:corsHeaders
        }
      );

    }






    const {
      data:user,
      error:userError
    }
    =
    await supabaseAdmin
    .from("site_users")
    .select("id")
    .eq(
      "id",
      session.user_id
    )
    .single();





    if(userError || !user){

      return Response.json(
        {
          success:false,
          error:"user not found"
        },
        {
          status:404,
          headers:corsHeaders
        }
      );

    }






    const {
      data:deleted,
      error:deleteError
    }
    =
    await supabaseAdmin
    .from("cart_items")
    .delete()
    .eq(
      "id",
      cart_item_id
    )
    .eq(
      "user_id",
      user.id
    )
    .select();






    if(deleteError){


      console.log(
        "DELETE ERROR:",
        deleteError
      );


      return Response.json(
        {
          success:false,
          error:deleteError.message
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
        message:"removed from cart",
        deleted
      },
      {
        status:200,
        headers:corsHeaders
      }
    );





  }
  catch(error){


    console.log(
      "GENERAL ERROR:",
      error
    );



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