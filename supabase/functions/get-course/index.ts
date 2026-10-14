import { createClient } from "https://esm.sh/@supabase/supabase-js@2";


const corsHeaders = {

  "Access-Control-Allow-Origin": "*",

  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",

  "Access-Control-Allow-Methods":
    "POST, OPTIONS",

};



const supabaseAdmin = createClient(

  Deno.env.get("SUPABASE_URL")!,

  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

);




Deno.serve(async(req)=>{


  if(req.method==="OPTIONS"){


    return new Response(

      null,

      {
        status:204,
        headers:corsHeaders
      }

    );


  }




  try{


    const {
      course_id
    }
    =
    await req.json();




    if(!course_id){


      return Response.json(

        {
          success:false,
          error:"missing course id"
        },

        {
          status:400,
          headers:corsHeaders
        }

      );


    }





    const {

      data:course,

      error

    }

    =
    await supabaseAdmin

    .from("courses")

    .select(`

      id,
      title,
      description,
      image_url,
      price,
      type

    `)

    .eq(

      "id",

      course_id

    )

    .single();







    if(error || !course){


      return Response.json(

        {
          success:false,
          error:"course not found"
        },

        {
          status:404,
          headers:corsHeaders
        }

      );


    }







    return Response.json(

      {

        success:true,

        course

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