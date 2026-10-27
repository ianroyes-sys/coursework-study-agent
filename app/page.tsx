import Coursework from "@/components/Coursework";
import design from "@/components/RoomDesign.module.css";

export default function Page() {
  return (
    <div className={`${design.room} ${design.school} mx-auto max-w-6xl px-4 py-8 sm:px-8`}>
      <section className={design.hero}>
        <div className={design.heroTop}>
          <p className={design.eyebrow}>Coursework</p>
        </div>
        <h1 className={design.title}>Make room to focus.</h1>
        <p className={design.description}>
          Your assignments, source material, and study preparation, organized around the next thing that needs you.
        </p>
      </section>
      <Coursework />
    </div>
  );
}
