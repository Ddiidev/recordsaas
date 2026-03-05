import * as React from 'react'
import {
  ArrowUpRight as ArrowUpRightIcon,
  Camera as CameraIcon,
  CameraSolid as CameraSolidIcon,
  Check as CheckIcon,
  CheckCircle as CheckCircleIcon,
  Circle as CircleIcon,
  CloudUpload as CloudUploadIcon,
  Computer as ComputerIcon,
  ControlSlider as ControlSliderIcon,
  CursorPointer as CursorPointerIcon,
  Cut as CutIcon,
  Download as DownloadIcon,
  Drag as DragIcon,
  Eye as EyeIcon,
  Folder as FolderIcon,
  GithubCircle as GithubCircleIcon,
  HomeAlt as HomeAltIcon,
  InfoCircle as InfoCircleIcon,
  InfoCircleSolid as InfoCircleSolidIcon,
  Lock as LockIcon,
  LogIn as LogInIcon,
  LogOut as LogOutIcon,
  MagicWand as MagicWandIcon,
  Microphone as MicrophoneIcon,
  MicrophoneMute as MicrophoneMuteIcon,
  MicrophoneSolid as MicrophoneSolidIcon,
  Minus as MinusIcon,
  Movie as MovieIcon,
  MusicNote as MusicNoteIcon,
  MusicNoteSolid as MusicNoteSolidIcon,
  NavArrowDown as NavArrowDownIcon,
  NavArrowUp as NavArrowUpIcon,
  Pause as PauseIcon,
  PathArrow as PathArrowIcon,
  PathArrowSolid as PathArrowSolidIcon,
  Play as PlayIcon,
  Plus as PlusIcon,
  Redo as RedoIcon,
  Refresh as RefreshIcon,
  RefreshCircle as RefreshCircleIcon,
  Rewind as RewindIcon,
  Search as SearchIcon,
  Settings as SettingsIcon,
  SkipNext as SkipNextIcon,
  SkipPrev as SkipPrevIcon,
  SoundHigh as SoundHighIcon,
  SoundLow as SoundLowIcon,
  SoundOff as SoundOffIcon,
  Square as SquareIcon,
  StyleBorder as StyleBorderIcon,
  Trash as TrashIcon,
  Upload as UploadIcon,
  UploadSquareSolid as UploadSquareSolidIcon,
  Undo as UndoIcon,
  UserCircle as UserCircleIcon,
  VideoCamera as VideoCameraIcon,
  VideoCameraOff as VideoCameraOffIcon,
  ViewGrid as ViewGridIcon,
  Xmark as XmarkIcon,
  XmarkCircle as XmarkCircleIcon,
  ZoomIn as ZoomInIcon,
} from 'iconoir-react'
import { cn } from '../../lib/utils'

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string
  className?: string
  children?: React.ReactNode
}

export type IconComponent = React.ComponentType<IconProps>

interface BaseCustomIconProps extends IconProps {
  viewBox?: string
}

interface IconShellProps {
  active?: boolean
  disabled?: boolean
  className?: string
  children: React.ReactNode
}

interface IconSwitchProps extends IconProps {
  regular: IconComponent
  solid?: IconComponent
  active?: boolean
}

const withIconMotion = (Comp: IconComponent, displayName: string) => {
  const Wrapped = ({ className, size, width, height, ...props }: IconProps) => (
    <Comp
      width={width ?? size}
      height={height ?? size}
      className={cn('icon-glyph', className)}
      {...props}
    />
  )

  Wrapped.displayName = displayName
  return Wrapped
}

const BaseCustomIcon = ({
  className,
  size,
  width,
  height,
  viewBox = '0 0 24 24',
  children,
  strokeWidth = 1.9,
  ...props
}: BaseCustomIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={width ?? size ?? 24}
    height={height ?? size ?? 24}
    viewBox={viewBox}
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={cn('icon-glyph', className)}
    {...props}
  >
    {children}
  </svg>
)

const KeyboardIcon = (props: IconProps) => (
  <BaseCustomIcon {...props}>
    <rect x="3" y="6" width="18" height="12" rx="2.5" />
    <path d="M6.5 10h.01" />
    <path d="M9.5 10h.01" />
    <path d="M12.5 10h.01" />
    <path d="M15.5 10h.01" />
    <path d="M18.5 10h.01" />
    <path d="M7.5 14h9" />
    <path d="M18.5 14h.01" />
  </BaseCustomIcon>
)

const RectangleIcon = (props: IconProps) => (
  <BaseCustomIcon {...props}>
    <rect x="3.5" y="7" width="17" height="10" rx="2.5" />
  </BaseCustomIcon>
)

const PhotoIcon = (props: IconProps) => (
  <BaseCustomIcon {...props}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M8 13.5l2.4-2.6a1 1 0 0 1 1.47 0L15 14.2l2.1-2.2a1 1 0 0 1 1.4-.05L21 14.5" />
    <circle cx="8.5" cy="9" r="1.3" />
  </BaseCustomIcon>
)

const GripVerticalIcon = (props: IconProps) => (
  <BaseCustomIcon {...props}>
    <circle cx="9" cy="7.5" r="0.8" fill="currentColor" />
    <circle cx="9" cy="12" r="0.8" fill="currentColor" />
    <circle cx="9" cy="16.5" r="0.8" fill="currentColor" />
    <circle cx="15" cy="7.5" r="0.8" fill="currentColor" />
    <circle cx="15" cy="12" r="0.8" fill="currentColor" />
    <circle cx="15" cy="16.5" r="0.8" fill="currentColor" />
  </BaseCustomIcon>
)

const DotsVerticalIcon = (props: IconProps) => (
  <BaseCustomIcon {...props}>
    <circle cx="12" cy="6.5" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="17.5" r="1" fill="currentColor" />
  </BaseCustomIcon>
)

const MarqueeSelectIcon = (props: IconProps) => (
  <BaseCustomIcon {...props}>
    <path d="M4 9V7.5A2.5 2.5 0 0 1 6.5 5H8" />
    <path d="M16 5h1.5A2.5 2.5 0 0 1 20 7.5V9" />
    <path d="M20 15v1.5A2.5 2.5 0 0 1 17.5 19H16" />
    <path d="M8 19H6.5A2.5 2.5 0 0 1 4 16.5V15" />
    <path d="M8 5h2" />
    <path d="M14 5h2" />
    <path d="M4 11v2" />
    <path d="M20 11v2" />
    <path d="M8 19h2" />
    <path d="M14 19h2" />
  </BaseCustomIcon>
)

const ShapeRadiusIcon = (props: IconProps) => (
  <BaseCustomIcon {...props}>
    <path d="M6 6h7a5 5 0 0 1 5 5v7" />
    <path d="M6 6v12h12" />
  </BaseCustomIcon>
)

const PaddingBoxIcon = (props: IconProps) => (
  <BaseCustomIcon {...props}>
    <rect x="4" y="4" width="16" height="16" rx="2.5" />
    <rect x="8" y="8" width="8" height="8" rx="1.5" />
  </BaseCustomIcon>
)

const ShadowDepthIcon = (props: IconProps) => (
  <BaseCustomIcon {...props}>
    <rect x="5" y="5" width="11" height="11" rx="2" />
    <path d="M10 19h7a2 2 0 0 0 2-2v-7" />
    <path d="M8 8h8" opacity="0.6" />
    <path d="M8 11h8" opacity="0.4" />
  </BaseCustomIcon>
)

const FlipHorizontalIcon = (props: IconProps) => (
  <BaseCustomIcon {...props}>
    <path d="M12 5v14" />
    <path d="M8 8l-3 4 3 4" />
    <path d="M16 8l3 4-3 4" />
  </BaseCustomIcon>
)

const HandClickIcon = (props: IconProps) => (
  <BaseCustomIcon {...props}>
    <path d="M9.5 11V6.5a1.5 1.5 0 1 1 3 0V13" />
    <path d="M12.5 9.5a1.5 1.5 0 0 1 3 0V14" />
    <path d="M15.5 10.5a1.5 1.5 0 0 1 3 0V15" />
    <path d="M9.5 12.5l-1-1A1.6 1.6 0 0 0 6 12.7l3.1 5a3 3 0 0 0 2.55 1.43H17a3 3 0 0 0 3-3v-3.6" />
    <path d="M7 5.5h.01" />
    <path d="M5 8.5h.01" />
    <path d="M9 3.5h.01" />
  </BaseCustomIcon>
)

const BanCircleIcon = (props: IconProps) => (
  <BaseCustomIcon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 15.5l7-7" />
  </BaseCustomIcon>
)

export function IconShell({ active = false, disabled = false, className, children }: IconShellProps) {
  return (
    <span
      className={cn(
        'icon-shell',
        active ? 'icon-shell-active' : 'icon-shell-muted',
        disabled && 'icon-shell-disabled',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function IconSwitch({ regular: Regular, solid: Solid, active = false, className, ...props }: IconSwitchProps) {
  const Comp = active && Solid ? Solid : Regular

  return <Comp className={cn(active && 'icon-glyph-active', className)} {...props} />
}

export const Stack3 = withIconMotion(ViewGridIcon, 'Stack3')
export const Loader2 = withIconMotion(RefreshCircleIcon, 'Loader2')
export const Check = withIconMotion(CheckIcon, 'Check')
export const Settings = withIconMotion(SettingsIcon, 'Settings')
export const Home = withIconMotion(HomeAltIcon, 'Home')
export const Folder = withIconMotion(FolderIcon, 'Folder')
export const Upload = withIconMotion(UploadIcon, 'Upload')
export const CloudUpload = withIconMotion(CloudUploadIcon, 'CloudUpload')
export const Plus = withIconMotion(PlusIcon, 'Plus')
export const Trash = withIconMotion(TrashIcon, 'Trash')
export const Lock = withIconMotion(LockIcon, 'Lock')
export const Rectangle = withIconMotion(RectangleIcon, 'Rectangle')
export const BoxPadding = withIconMotion(PaddingBoxIcon, 'BoxPadding')
export const BorderRadius = withIconMotion(ShapeRadiusIcon, 'BorderRadius')
export const Shadow = withIconMotion(ShadowDepthIcon, 'Shadow')
export const BorderAll = withIconMotion(StyleBorderIcon, 'BorderAll')
export const Scissors = withIconMotion(CutIcon, 'Scissors')
export const ZoomIn = withIconMotion(ZoomInIcon, 'ZoomIn')
export const ArrowBackUp = withIconMotion(UndoIcon, 'ArrowBackUp')
export const ArrowForwardUp = withIconMotion(RedoIcon, 'ArrowForwardUp')
export const PlayerTrackNext = withIconMotion(SkipNextIcon, 'PlayerTrackNext')
export const Search = withIconMotion(SearchIcon, 'Search')
export const Refresh = withIconMotion(RefreshIcon, 'Refresh')
export const Video = withIconMotion(VideoCameraIcon, 'Video')
export const ChevronDown = withIconMotion(NavArrowDownIcon, 'ChevronDown')
export const ChevronUp = withIconMotion(NavArrowUpIcon, 'ChevronUp')
export const Microphone = withIconMotion(MicrophoneIcon, 'Microphone')
export const DeviceComputerCamera = withIconMotion(CameraIcon, 'DeviceComputerCamera')
export const LayoutBoard = withIconMotion(ViewGridIcon, 'LayoutBoard')
export const Route = withIconMotion(PathArrowIcon, 'Route')
export const Pointer = withIconMotion(CursorPointerIcon, 'Pointer')
export const FileImport = withIconMotion(UploadIcon, 'FileImport')
export const Movie = withIconMotion(MovieIcon, 'Movie')
export const ArrowsMove = withIconMotion(DragIcon, 'ArrowsMove')
export const Minus = withIconMotion(MinusIcon, 'Minus')
export const X = withIconMotion(XmarkIcon, 'X')
export const Download = withIconMotion(DownloadIcon, 'Download')
export const Camera = withIconMotion(CameraIcon, 'Camera')
export const Music = withIconMotion(MusicNoteIcon, 'Music')
export const AdjustmentsHorizontal = withIconMotion(ControlSliderIcon, 'AdjustmentsHorizontal')
export const Wand = withIconMotion(MagicWandIcon, 'Wand')
export const Photo = withIconMotion(PhotoIcon, 'Photo')
export const BrandGithub = withIconMotion(GithubCircleIcon, 'BrandGithub')
export const Login = withIconMotion(LogInIcon, 'Login')
export const Logout = withIconMotion(LogOutIcon, 'Logout')
export const UserCircle = withIconMotion(UserCircleIcon, 'UserCircle')
export const InfoCircle = withIconMotion(InfoCircleIcon, 'InfoCircle')
export const Keyboard = withIconMotion(KeyboardIcon, 'Keyboard')
export const HandClick = withIconMotion(HandClickIcon, 'HandClick')
export const MicrophoneOff = withIconMotion(MicrophoneMuteIcon, 'MicrophoneOff')
export const DeviceComputerCameraOff = withIconMotion(VideoCameraOffIcon, 'DeviceComputerCameraOff')
export const DeviceDesktop = withIconMotion(ComputerIcon, 'DeviceDesktop')
export const Marquee2 = withIconMotion(MarqueeSelectIcon, 'Marquee2')
export const Square = withIconMotion(SquareIcon, 'Square')
export const Eye = withIconMotion(EyeIcon, 'Eye')
export const Circle = withIconMotion(CircleIcon, 'Circle')
export const SquareToggle = withIconMotion(FlipHorizontalIcon, 'SquareToggle')
export const ArrowsUpRight = withIconMotion(ArrowUpRightIcon, 'ArrowsUpRight')
export const GripVertical = withIconMotion(GripVerticalIcon, 'GripVertical')
export const Volume = withIconMotion(SoundHighIcon, 'Volume')
export const Volume2 = withIconMotion(SoundLowIcon, 'Volume2')
export const Volume3 = withIconMotion(SoundOffIcon, 'Volume3')
export const DotsVertical = withIconMotion(DotsVerticalIcon, 'DotsVertical')
export const CircleCheck = withIconMotion(CheckCircleIcon, 'CircleCheck')
export const CircleX = withIconMotion(XmarkCircleIcon, 'CircleX')
export const Ban = withIconMotion(BanCircleIcon, 'Ban')
export const PlayerPlay = withIconMotion(PlayIcon, 'PlayerPlay')
export const PlayerTrackPrev = withIconMotion(RewindIcon, 'PlayerTrackPrev')
export const PlayerPause = withIconMotion(PauseIcon, 'PlayerPause')
export const PlayerSkipBack = withIconMotion(SkipPrevIcon, 'PlayerSkipBack')
export const PlayerSkipForward = withIconMotion(SkipNextIcon, 'PlayerSkipForward')

export const CameraSolid = withIconMotion(CameraSolidIcon, 'CameraSolid')
export const MicrophoneSolid = withIconMotion(MicrophoneSolidIcon, 'MicrophoneSolid')
export const InfoCircleSolid = withIconMotion(InfoCircleSolidIcon, 'InfoCircleSolid')
export const MusicNoteSolid = withIconMotion(MusicNoteSolidIcon, 'MusicNoteSolid')
export const PathArrowSolid = withIconMotion(PathArrowSolidIcon, 'PathArrowSolid')
export const UploadSquareSolid = withIconMotion(UploadSquareSolidIcon, 'UploadSquareSolid')

export const FullscreenIcon = (props: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={props.size ?? 24}
    height={props.size ?? 24}
    viewBox="0 -960 960 960"
    fill="currentColor"
    className={cn('icon-glyph', props.className)}
    {...props}
  >
    <path d="M120-120v-200h80v120h120v80H120Zm520 0v-80h120v-120h80v200H640ZM120-640v-200h200v80H200v120h-80Zm640 0v-120H640v-80h200v200h-80Z" />
  </svg>
)

export const ExitFullscreenIcon = (props: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={props.size ?? 24}
    height={props.size ?? 24}
    viewBox="0 -960 960 960"
    fill="currentColor"
    className={cn('icon-glyph', props.className)}
    {...props}
  >
    <path d="M240-120v-120H120v-80h200v200h-80Zm400 0v-200h200v80H720v120h-80ZM120-640v-80h120v-120h80v200H120Zm520 0v-200h80v120h120v80H640Z" />
  </svg>
)

export const FlipScissorsIcon = (props: IconProps) => (
  <BaseCustomIcon {...props}>
    <g transform="translate(24,0) scale(-1,1)">
      <circle cx="6" cy="7" r="2.6" />
      <circle cx="6" cy="17" r="2.6" />
      <path d="M8.7 8.6L19 19" />
      <path d="M8.7 15.4L19 5" />
    </g>
  </BaseCustomIcon>
)

export const PaintBrushIcon = (props: IconProps) => (
  <BaseCustomIcon {...props}>
    <path d="m14.6 17.9-10.7-2.9" />
    <path d="M18.4 2.6a1 1 0 1 1 3 3L17.4 9.7a.5.5 0 0 0 0 .7l.9.9a2.4 2.4 0 0 1 0 3.4l-.9.9a.5.5 0 0 1-.7 0L8.4 7.3a.5.5 0 0 1 0-.7l.9-.9a2.4 2.4 0 0 1 3.4 0l.9.9a.5.5 0 0 0 .7 0z" />
    <path d="M9 8c-1.8 2.7-4 3.5-6.6 3.9a.5.5 0 0 0-.3.8l7.3 8.9a1 1 0 0 0 1.2.2C12.7 20.4 16 16.8 16 15" />
  </BaseCustomIcon>
)

export const SparklesIcon = (props: IconProps) => (
  <BaseCustomIcon {...props}>
    <path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2-2a2 2 0 0 1-2-2a2 2 0 0 1-2 2z" />
    <path d="M16 6a2 2 0 0 1 2 2a2 2 0 0 1 2-2a2 2 0 0 1-2-2a2 2 0 0 1-2 2z" />
    <path d="M9 18a6 6 0 0 1 6-6a6 6 0 0 1-6-6a6 6 0 0 1-6 6a6 6 0 0 1 6 6z" />
  </BaseCustomIcon>
)

export const TransformPointBottomLeftIcon = (props: IconProps) => (
  <BaseCustomIcon {...props}>
    <rect x="3" y="3" width="4" height="4" rx="1" />
    <rect x="3" y="17" width="4" height="4" rx="1" fill="currentColor" />
    <rect x="17" y="3" width="4" height="4" rx="1" />
    <rect x="17" y="17" width="4" height="4" rx="1" />
    <path d="M11 5h2" />
    <path d="M5 11v2" />
    <path d="M19 11v2" />
    <path d="M11 19h2" />
  </BaseCustomIcon>
)
