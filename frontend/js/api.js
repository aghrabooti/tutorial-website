const API_URL = "https://qbsfotperzzhuimnpmto.supabase.co/functions/v1";


async function apiCall(functionName, data){

    const response = await fetch(
        `${API_URL}/${functionName}`,
        {
            method:"POST",
            headers:{
                "Content-Type":"application/json"
            },
            body:JSON.stringify(data)
        }
    );


    return await response.json();

}