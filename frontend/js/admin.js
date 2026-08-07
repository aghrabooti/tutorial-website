async function checkAdmin(){


const token =
localStorage.getItem(
"session_token"
);



if(!token){

window.location.href="login.html";

return;

}



const user =
JSON.parse(
localStorage.getItem("user")
);



if(!user || user.role !== "admin"){


alert(
"دسترسی غیرمجاز"
);


window.location.href="dashboard.html";


return;


}


}



checkAdmin();