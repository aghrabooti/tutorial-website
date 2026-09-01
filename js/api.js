const API_URL = "https://qbsfotperzzhuimnpmto.supabase.co/functions/v1";


const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFic2ZvdHBlcnp6aHVpbW5wbXRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3MTM2NzIsImV4cCI6MjA5OTI4OTY3Mn0.N8Pv0hz3yKLcTVvwfiRlKW-yEE-d4vc1rkroZBglyTA";


async function apiCall(functionName, data){

    const response = await fetch(
        `${API_URL}/${functionName}`,
        {
            method:"POST",
            headers:{
                "Content-Type":"application/json",
                "Authorization":`Bearer ${SUPABASE_ANON_KEY}`
            },
            body:JSON.stringify(data)
        }
    );


    return await response.json();

}