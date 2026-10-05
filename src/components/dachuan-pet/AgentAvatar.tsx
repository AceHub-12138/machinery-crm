import Image from "next/image";
import petHeadSmile from "./assets/pet-head-smile.png";
import petHeadThinking from "./assets/pet-head-thinking.png";
import petHeadWink from "./assets/pet-head-wink.png";

export type AgentExpression = "smile" | "thinking" | "wink";
export type AgentPresence = "connecting" | "online";

type AgentAvatarProps = {
  expression: AgentExpression;
  presence?: AgentPresence;
  alt: string;
  className?: string;
  priority?: boolean;
};

const avatarByExpression = {
  smile: petHeadSmile,
  thinking: petHeadThinking,
  wink: petHeadWink,
};

export function AgentAvatar({
  expression,
  presence = "connecting",
  alt,
  className,
  priority = false,
}: AgentAvatarProps) {
  return (
    <div className={`relative ${className ?? ""}`}>
      <Image
        src={avatarByExpression[expression]}
        alt={alt}
        draggable={false}
        priority={priority}
        className="h-full w-full object-contain"
      />
      {presence === "online" && (
        <span
          aria-label="小川 Ai 助手在线"
          className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-white bg-emerald-500 shadow-sm"
        />
      )}
    </div>
  );
}
