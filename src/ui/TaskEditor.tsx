import React from 'react';
import { closeSheets, confirmDanger, deleteTask, showToast, upsertTask, useApp } from '../app/store';
import { DateField, Picker, Sheet, TimeField } from './common';

export default function TaskEditor(props: { taskId: string | null }) {
  const s = useApp();
  const existing = props.taskId ? (s.data.tasks || []).find(function (t) { return t.id === props.taskId; }) : undefined;

  const [title, setTitle] = React.useState(existing ? existing.title : '');
  const [courseId, setCourseId] = React.useState(existing ? (existing.courseId || '') : '');
  const [due, setDue] = React.useState(existing ? (existing.due || '') : '');
  const [time, setTime] = React.useState(
    existing && existing.dueMinutes !== undefined
      ? ('0' + Math.floor(existing.dueMinutes / 60)).slice(-2) + ':' + ('0' + (existing.dueMinutes % 60)).slice(-2)
      : '23:59'
  );
  const [note, setNote] = React.useState(existing ? (existing.note || '') : '');

  function save() {
    const t = title.trim();
    if (!t) { showToast('先给任务起个名字', 'warn'); return; }
    let dueMinutes: number | undefined;
    if (due && /^\d{2}:\d{2}$/.test(time)) {
      dueMinutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
    }
    upsertTask({
      id: existing ? existing.id : undefined,
      title: t,
      courseId: courseId || undefined,
      due: due || undefined,
      dueMinutes: due ? dueMinutes : undefined,
      note: note.trim() || undefined,
    });
    closeSheets();
  }

  return (
    <Sheet
      title={existing ? '编辑任务' : '新建任务'}
      onClose={closeSheets}
      right={<button className="btn sm primary" onClick={save}>保存</button>}
    >
      <div className="field">
        <div className="field-label">任务内容</div>
        <input className="input" value={title} placeholder="例如：高数作业 第 5 章" onChange={function (e) { setTitle(e.target.value); }} />
      </div>

      <div className="field">
        <div className="field-label">关联课程</div>
        <Picker
          title="关联课程"
          value={courseId}
          options={[{ value: '', label: '不关联' }].concat(
            s.data.courses.map(function (c) { return { value: c.id, label: c.name, sub: c.teacher || undefined }; })
          )}
          onChange={setCourseId}
        />
      </div>

      <div className="field">
        <div className="field-label">截止日期</div>
        <DateField value={due} onChange={setDue} placeholder="不设截止" />
      </div>

      {due ? (
        <div className="field">
          <div className="field-label">截止时刻</div>
          <TimeField value={time} onChange={setTime} />
          <div className="field-label" style={{ marginTop: 6 }}>
            会在到期前一天、前两小时各提醒一次
          </div>
        </div>
      ) : null}

      <div className="field">
        <div className="field-label">备注</div>
        <input className="input" value={note} placeholder="选填" onChange={function (e) { setNote(e.target.value); }} />
      </div>

      {existing ? (
        <button
          className="btn danger block" style={{ marginTop: 6 }}
          onClick={function () {
            void (async function () {
              if (await confirmDanger('删除「' + existing.title + '」？', '删除')) { deleteTask(existing.id); closeSheets(); }
            })();
          }}
        >删除任务</button>
      ) : null}
    </Sheet>
  );
}
