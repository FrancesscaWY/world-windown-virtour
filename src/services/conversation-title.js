export async function requestConversationTitle(messages,{signal}={}){
  const response=await fetch('/api/conversations/title',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({messages}),signal:AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(15000)])});
  if(!response.ok)throw new Error('Title unavailable');
  const result=await response.json();return result.title;
}
