import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Ship Check Playground. Before you ship, check. Findings, to verify, coverage.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ink = "#19372e";
const cream = "#f6f3e9";
const lime = "#e0ee8b";

function SmallLabel({label,mark,color}:{label:string;mark:string;color:string}) {
  return <div style={{display:"flex",alignItems:"center",gap:12,padding:"11px 16px",
    borderRadius:26,backgroundColor:"#fffdf4",border:"1px solid #d7dfd2"}}>
    <div style={{display:"flex",width:24,height:24,alignItems:"center",justifyContent:"center",
      backgroundColor:color,borderRadius:14,fontFamily:"Arial",fontWeight:700,fontSize:14}}>{mark}</div>
    <span style={{fontFamily:"Arial",fontSize:18,fontWeight:600,color:ink}}>{label}</span>
  </div>;
}

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{width:1200,height:630,position:"relative",display:"flex",
      backgroundColor:cream,color:ink,overflow:"hidden"}}>
      <div style={{position:"absolute",display:"flex",width:950,height:370,left:-160,bottom:-299,
        borderRadius:470,backgroundColor:"#d1dfca",transform:"rotate(-8deg)"}}/>
      <div style={{position:"absolute",display:"flex",width:820,height:300,left:360,bottom:-255,
        borderRadius:420,backgroundColor:"#aac1ad",transform:"rotate(-10deg)"}}/>
      <div style={{position:"absolute",display:"flex",width:850,height:300,right:-350,bottom:-215,
        borderRadius:425,backgroundColor:ink,transform:"rotate(-11deg)"}}/>

      <div style={{display:"flex",flexDirection:"column",position:"relative",zIndex:2,
        width:790,padding:"48px 0 48px 62px"}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{display:"flex",width:46,height:46,backgroundColor:lime,borderRadius:12,
            alignItems:"center",justifyContent:"center"}}>
            <div style={{display:"flex",width:23,height:23,borderRadius:12,backgroundColor:ink}}/>
          </div>
          <span style={{fontFamily:"Georgia,serif",fontSize:40,letterSpacing:-1.5}}>ship/check</span>
        </div>
        <div style={{display:"flex",flexDirection:"column",marginTop:64,
          fontFamily:"Georgia,serif",fontSize:71,letterSpacing:-3,lineHeight:1.05}}>
          <span>Before you ship,</span>
          <span>check.</span>
        </div>
        <div style={{display:"flex",marginTop:12,width:225,height:7,borderRadius:8,backgroundColor:lime}}/>
        <div style={{display:"flex",flexDirection:"column",marginTop:32,
          fontFamily:"Arial",fontSize:25,lineHeight:1.35}}>
          <span>See what needs fixing, and what</span>
          <span>still needs checking.</span>
        </div>
        <div style={{display:"flex",alignItems:"center",alignSelf:"flex-start",marginTop:"auto",
          padding:"13px 18px",backgroundColor:lime,borderRadius:10,
          fontFamily:"Arial",fontSize:16,fontWeight:700,letterSpacing:1}}>
          PUBLIC PLAYGROUND - NO SIGN-IN
        </div>
      </div>

      <div style={{position:"relative",display:"flex",flex:1,alignItems:"center",
        justifyContent:"center",marginTop:16}}>
        <div style={{position:"absolute",display:"flex",width:340,height:340,top:122,left:-2,
          borderRadius:170,border:"2px solid #a9bba9"}}/>
        <div style={{position:"absolute",display:"flex",width:260,height:260,top:162,left:38,
          borderRadius:130,border:"2px solid #a9bba9"}}/>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",
          width:182,height:182,marginRight:95,marginBottom:15,zIndex:1,
          borderRadius:100,backgroundColor:ink}}>
          <div style={{display:"flex",width:60,height:90,transform:"rotate(42deg)",
            borderBottom:"16px solid white",borderRight:"16px solid white",marginBottom:23}}/>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:30,position:"absolute",
          right:15,top:136,zIndex:3}}>
          <SmallLabel label="Findings" mark="!" color="#f1b19e"/>
          <SmallLabel label="To verify" mark="?" color={lime}/>
          <SmallLabel label="Coverage" mark="OK" color="#bdd8c0"/>
        </div>
      </div>
    </div>,
    size
  );
}
