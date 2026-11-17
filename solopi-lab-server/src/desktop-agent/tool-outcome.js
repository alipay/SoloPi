// One tool-outcome contract for Desktop, CLI and Server projections.
function failed(value,isError=false){return isError===true||!!value?.commandId&&['failed','cancelled'].includes(value.status)||value?.success===false||value?.isError===true||(value?.success!==true&&!!value?.error);}
function status(value,isError=false){return failed(value,isError)?'failed':'done';}
module.exports={failed,status};
